import { parseLandLedger } from '../services/vworld/landLedger';
import { parseLandPrice, LandPriceValidationError } from '../services/vworld/landPrice';
import type { LandPrice } from '../services/vworld/landPrice';
import { priceResponseShape } from './priceResponseShape';
import { attributeRows, object, pnu, ParcelError } from '../services/vworld/parcelValidation';
import { readEnvironment } from '../config/env';
import { requestSandboxJsonp } from '../services/vworld/sandboxJsonp';

export type ProbeService = 'ledger' | 'price';
export interface ProbeReport {
  executed: boolean;
  transport: string;
  state: 'blocked' | 'success' | 'not-found' | 'failed';
  httpStatus: number | null;
  apiCode: string;
  count: number | null;
  fields: string[];
  year: string | null;
  date: string | null;
  updatedAt: string | null;
  message: string;
  pnuMatches?: boolean;
  landCategory?: string | null;
  area?: number | null;
  price?: number | null;
  month?: string | null;
  landCategoryCode?: string | null;
  diagnostic?: string;
  failureStage?: string;
  responseShape?: string[];
  priceRecords?: Omit<LandPrice, 'pnu'>[];
  priceCompleteness?: 'complete' | 'partial' | 'unknown';
  totalCount?: number | null;
  pageSize?: number | null;
  pageNo?: number | null;
  duplicatesRemoved?: number;
  yearMode?: 'specified' | 'omitted';
  returnedYears?: string[];
  historyCoverage?: 'unknown';
  requestedPage?: number;
}
const allowedFields = {
  ledger: ['pnu', 'lndcgrCode', 'lndcgrCodeNm', 'lndpclAr', 'lastUpdtDt'],
  price: ['pnu', 'stdrYear', 'stdrMt', 'pblntfPclnd', 'pblntfDe', 'lastUpdtDt'],
} as const;
const knownCodes = new Set(['00', '0', 'PARAM_REQUIRED', 'INVALID_TYPE', 'INVALID_RANGE', 'INVALID_KEY',
  'INCORRECT_KEY', 'UNAVAILABLE_KEY', 'OVER_REQUEST_LIMIT', 'SYSTEM_ERROR', 'UNKNOWN_ERROR']);
function initial(): ProbeReport {
  return { executed: false, transport: '미확인', state: 'blocked', httpStatus: null,
    apiCode: '미확인', count: null, fields: [], year: null, date: null, updatedAt: null, message: '' };
}

const active = new Set<ProbeService>();
const authenticationCodes = new Set(['INVALID_KEY', 'INCORRECT_KEY', 'UNAVAILABLE_KEY']);

// 공식 JSONP 예제의 파라미터만 사용한다. 지적 전용 GetFeature 파라미터는 전달하지 않는다.
export async function runAttributeProbe(service: ProbeService, input: string, year: string | undefined, signal = new AbortController().signal, requestedPage = 1): Promise<ProbeReport> {
  const result = initial();
  result.transport = 'sandbox JSONP';
  if (!import.meta.env.DEV) return { ...result, message: '개발 환경에서만 사용할 수 있습니다.' };
  if (service !== 'ledger' && service !== 'price') return { ...result, message: '허용되지 않은 서비스입니다.' };
  result.requestedPage = requestedPage;
  if (requestedPage !== 1 && !(requestedPage === 2 && service === 'price' && year === undefined)) return { ...result, message: '페이지 2는 기준연도 생략 조회에서만 선택할 수 있습니다. 페이지는 1 또는 2여야 합니다.' };
  try { pnu(input); } catch { return { ...result, message: 'PNU는 공백 없는 19자리 숫자 문자열이어야 합니다.' }; }
  if (service === 'price') { result.yearMode = year === undefined ? 'omitted' : 'specified'; result.historyCoverage = 'unknown'; }
  if (service === 'price' && year !== undefined && !/^\d{4}$/.test(year)) return { ...result, message: '기준연도를 네 자리 숫자로 입력하세요.' };
  if (signal.aborted) return { ...result, message: '화면이 해제되어 요청하지 않았습니다.' };
  if (active.has(service)) return { ...result, message: '이 서비스의 요청이 진행 중입니다. 중복 요청하지 않았습니다.' };
  let key: string, domain: string | undefined;
  try {
    const env = readEnvironment(); key = env.vworldApiKey; domain = env.vworldDomain;
    if (!domain) return { ...result, diagnostic: 'ATTRIBUTE_CONFIGURATION', message: '등록 domain 설정이 없습니다. 요청하지 않았습니다.' };
    const parsed = new URL(domain);
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || /\s/.test(domain)) throw new Error();
  } catch { return { ...result, diagnostic: 'ATTRIBUTE_CONFIGURATION', message: '키 또는 domain 설정을 확인하세요. 인증정보는 표시하지 않습니다.' }; }
  const parameters = new URLSearchParams({ pnu: input, key, domain, format: 'json', numOfRows: '10', pageNo: String(requestedPage) });
  if (service === 'price' && year !== undefined) parameters.set('stdrYear', year);
  active.add(service);
  try {
    result.executed = true; // iframe 전송 함수 호출 시도. 실제 HTTP 송신·상태는 별도 관측이 필요하다.
    const payload = await requestSandboxJsonp(service, parameters, signal);
    const report = summarizeAttributeResponse(service, payload, input, year, requestedPage);
    // 허용 필드에도 서버가 인증정보를 넣을 가능성에 대비해 최종 문자열을 정리한다.
    report.landCategory = report.landCategory?.split(key).join('[인증정보 제외]').replace(/https?:\/\/\S+/gi, '[URL 제외]');
    return { ...report, transport: 'sandbox JSONP', message: report.state === 'success' && service === 'ledger' ? 'PNU·서비스 응답 검증을 통과했습니다.' : report.message };
  } catch (error) {
    const kind = error instanceof ParcelError ? error.kind : error instanceof DOMException && error.name === 'AbortError' ? 'invalidated' : 'transport';
    return { ...result, state: 'failed', diagnostic: kind === 'timeout' ? 'ATTRIBUTE_TIMEOUT' : kind === 'invalidated' ? 'ATTRIBUTE_INVALIDATED' : 'ATTRIBUTE_TRANSPORT',
      message: kind === 'timeout' ? '응답 시간이 초과되었습니다. 자동 재시도하지 않습니다.' : kind === 'invalidated' ? '화면 해제로 요청 결과를 무효화했습니다.' : 'JSONP 로드·실행 또는 전송 초기화에 실패했습니다. HTTP·인증 오류 여부는 이 상태만으로 확정할 수 없습니다.' };
  } finally { active.delete(service); }
}

// 기존 파서를 사용하는 순수 응답 요약 함수. 모의 호출과 실제 전송을 구분한다.
// 원문·서버 메시지·임의 필드명은 반환하지 않는다.
export function summarizeAttributeResponse(service: ProbeService, payload: unknown, input: string, year: string | undefined, requestedPage = 1): ProbeReport {
  const result: ProbeReport = { ...initial(), executed: true, transport: '모의 데이터 — 실제 통신 없음' };
  if (service === 'price') {
    result.requestedPage = requestedPage;
    result.responseShape = priceResponseShape(payload);
    result.yearMode = year === undefined ? 'omitted' : 'specified';
    result.historyCoverage = 'unknown';
  }
  try {
    const rootName = service === 'ledger' ? 'ladfrlVOList' : 'indvdLandPrices';
    const envelope = object(payload);
    const response = envelope.response && typeof envelope.response === 'object' ? object(envelope.response) : envelope;
    if (response.status === 'ERROR' || response.error) {
      const error = response.error && typeof response.error === 'object' ? object(response.error) : {};
      const code = typeof error.code === 'string' && knownCodes.has(error.code) ? error.code : '미확인 또는 허용 목록 밖';
      return { ...result, state: 'failed', apiCode: code, failureStage: service === 'price' ? 'api' : undefined, diagnostic: authenticationCodes.has(code) ? 'ATTRIBUTE_AUTH' : 'ATTRIBUTE_API', message: authenticationCodes.has(code) ? '인증키·등록 domain 또는 서비스 권한을 확인하세요.' : 'API가 오류를 반환했습니다. 서버 원문은 표시하지 않습니다.' };
    }
    const root = object(envelope[rootName]);
    result.apiCode = typeof root.resultCode === 'string' && knownCodes.has(root.resultCode) ? root.resultCode : '미확인 또는 허용 목록 밖';
    if (root.resultCode !== undefined && root.resultCode !== null && root.resultCode !== '' && root.resultCode !== '00' && root.resultCode !== '0') {
      return { ...result, state: 'failed', failureStage: service === 'price' ? 'api' : undefined, diagnostic: authenticationCodes.has(result.apiCode) ? 'ATTRIBUTE_AUTH' : 'ATTRIBUTE_API', message: 'API 오류 상태입니다. 서버 오류 원문은 표시하지 않습니다.' };
    }
    if (service === 'price') {
      const price = parseLandPrice(payload, input, year, requestedPage);
      if (price.status === 'not-found') return { ...result, state: 'not-found', count: 0, message: '정상 빈 응답(totalCount=0)입니다. 해당 자료가 없습니다.' };
      if (price.status !== 'ok') throw new Error();
      const batch = price.value;
      const records = batch.records.map(({ pnu: _pnu, ...record }) => record);
      // 한 행인 경우에만 기존 단일 값 요약을 유지한다. 여러 행에서 최신/첫 행을 선택하지 않는다.
      const single = records.length === 1 ? records[0] : undefined;
      return { ...result, state: 'success', count: batch.returnedCount, pnuMatches: batch.returnedCount > 0 ? true : undefined,
        fields: batch.fields, priceRecords: records, priceCompleteness: batch.completeness,
        returnedYears: [...new Set(records.map((record) => record.year))].sort(),
        totalCount: batch.totalCount, pageSize: batch.pageSize, pageNo: batch.pageNo, duplicatesRemoved: batch.duplicatesRemoved,
        year: single?.year ?? null, month: single?.month ?? null, date: single?.publishedAt ?? null,
        updatedAt: single?.updatedAt ?? null, price: single?.pricePerSquareMeter,
        message: batch.completeness === 'partial' ? '일부 자료만 반환되었습니다. 표시 목록은 전체 결과가 아닙니다. 추가 페이지는 자동 조회하지 않습니다.'
          : batch.completeness === 'unknown' ? '레코드는 검증했으나 페이지 메타데이터가 부족해 전체 결과인지 미확인입니다.'
          : '공시지가 레코드와 페이지 검증을 통과했습니다. 응답 순서대로 표시하며 최신 자료를 자동 선택하지 않습니다.' };
    }
    const rows = attributeRows(payload, rootName, input);
    const state = parseLandLedger(payload, input);
    result.count = rows.length;
    result.fields = allowedFields[service].filter((name) => rows.some((row) => Object.hasOwn(row, name)));
    if (state.status === 'not-found') {
      if (String(root.totalCount) !== '0') throw new Error();
      return { ...result, state: 'not-found', message: '정상 빈 응답(totalCount=0)입니다. 해당 자료가 없습니다.' };
    }
    if (state.status !== 'ok') return { ...result, state: 'failed', message: '응답을 처리하지 못했습니다.' };
    result.updatedAt = state.value.updatedAt;
    result.pnuMatches = true;
    if (service === 'ledger') {
      const ledger = parseLandLedger(payload, input);
      if (ledger.status === 'ok') { result.landCategory = ledger.value.landCategoryName; result.landCategoryCode = ledger.value.landCategoryCode; result.area = ledger.value.registeredArea; }
    }
    return { ...result, state: 'success', message: '모의 응답의 PNU와 기존 서비스 파서 검증을 통과했습니다. 실제 API 성공을 뜻하지 않습니다.' };
  } catch (error) {
    const stage = error instanceof LandPriceValidationError ? error.stage : service === 'price' ? 'envelope' : undefined;
    return { ...result, state: 'failed', diagnostic: 'ATTRIBUTE_RESPONSE_INVALID', failureStage: stage,
      message: '응답 검증에 실패했습니다. 실패 단계와 자료형 요약을 확인하세요. 원문과 인증정보는 표시하지 않습니다.' };
  }
}
