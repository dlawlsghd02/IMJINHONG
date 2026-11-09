import { requestSandboxJsonp } from './sandboxJsonp';
import { object, pnu, ParcelError } from './parcelValidation';

export interface AttributeAuthentication { apiKey: string; domain?: string; }

// 기존 sandbox를 재사용하고 서비스별 요청값만 구성한다. 재시도·추가 페이지는 없다.
export async function requestParcelAttribute(service: 'ledger' | 'price', id: string,
  auth: AttributeAuthentication, signal: AbortSignal, year?: string, pageNo = 1): Promise<unknown> {
  pnu(id);
  if (!Number.isSafeInteger(pageNo) || pageNo < 1 || (service === 'ledger' || year !== undefined) && pageNo !== 1) throw new ParcelError('속성 조회 페이지 조건이 올바르지 않습니다.');
  if (!auth.apiKey.trim() || !auth.domain) throw new ParcelError('속성 API 인증 설정이 없습니다.');
  const domain = auth.domain.trim();
  let valid = false;
  try {
    const url = new URL(domain);
    valid = ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash && !/\s/.test(domain);
  } catch { /* 인증 설정 원문은 출력하지 않는다. */ }
  if (!valid) throw new ParcelError('속성 API domain 설정 형식을 확인하세요.');
  const params = new URLSearchParams({ pnu: id, key: auth.apiKey.trim(), domain, format: 'json', numOfRows: '10', pageNo: String(pageNo) });
  if (service === 'price') {
    if (year !== undefined) {
      if (!/^\d{4}$/.test(year)) throw new ParcelError('공시지가 요청 연도를 확인하세요.');
      params.set('stdrYear', year);
    }
  }
  const payload = await requestSandboxJsonp(service, params, signal);
  const envelope = object(payload);
  const response = envelope.response && typeof envelope.response === 'object' ? object(envelope.response) : envelope;
  if (response.status === 'ERROR' || response.error) throw new ParcelError('속성 API가 오류를 반환했습니다. 인증·서비스 권한·요청 제한을 확인하세요.', 'api');
  const root = object(envelope[service === 'ledger' ? 'ladfrlVOList' : 'indvdLandPrices']);
  if (root.resultCode !== undefined && root.resultCode !== null && root.resultCode !== '' && root.resultCode !== '00' && root.resultCode !== '0') {
    throw new ParcelError('속성 API가 오류를 반환했습니다. 정상적인 자료 없음과 다릅니다.', 'api');
  }
  return payload;
}

export function attributeFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '조회가 취소되었습니다. 다시 필지를 선택하면 조회할 수 있습니다.';
  if (error instanceof ParcelError) return error.message; // 애플리케이션에서 작성한 고정 안내만 사용
  return '속성정보 조회에 실패했습니다. 자동 재시도하지 않습니다.';
}
