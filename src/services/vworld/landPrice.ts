import { date, nonNegative, pnu, text, object, integer, ParcelError } from './parcelValidation';
import type { AttributeState } from './parcelValidation';
import { requestParcelAttribute, attributeFailure } from './attributeRequest';
import type { AttributeAuthentication } from './attributeRequest';

export const landPriceSource = 'https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=25';
export interface LandPrice {
  pnu: string;
  pricePerSquareMeter: number | null;
  year: string;
  month: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface LandPriceBatch {
  records: LandPrice[];
  returnedCount: number;
  totalCount: number | null;
  pageSize: number | null;
  pageNo: number | null;
  completeness: 'complete' | 'partial' | 'unknown';
  duplicatesRemoved: number;
  fields: string[];
}
export type PriceFailureStage = 'input' | 'envelope' | 'rows' | 'api' | 'pnu' | 'year' | 'month' | 'price' | 'published-date' | 'updated-date' | 'page';
export class LandPriceValidationError extends ParcelError {
  constructor(readonly stage: PriceFailureStage) {
    super(`공시지가 응답 검증 단계: ${stage}`);
  }
}
function check<T>(stage: PriceFailureStage, run: () => T): T {
  try { return run(); } catch { throw new LandPriceValidationError(stage); }
}

export function parseLandPrice(payload: unknown, requestedPnu: string, year: string | undefined, requestedPage = 1): AttributeState<LandPriceBatch> {
  // undefined는 연도 생략 응답 검증용이다. 빈 문자열은 허용하지 않는다.
  check('input', () => { pnu(requestedPnu); if (year !== undefined && !/^\d{4}$/.test(year)) throw new Error(); });
  check('page', () => { if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || year !== undefined && requestedPage !== 1) throw new Error(); });
  const root = check('envelope', () => object(object(payload).indvdLandPrices));
  check('api', () => {
    const code = root.resultCode;
    if (code !== undefined && code !== null && code !== '' && code !== '00' && code !== '0') throw new Error();
  });
  const rows = check('rows', () => {
    if (!Array.isArray(root.field)) throw new Error();
    return root.field.map((row) => object(row));
  });
  const metadata = check('page', () => {
    if (rows.length > 10) throw new Error();
    const totalCount = root.totalCount === undefined ? null : integer(root.totalCount);
    const pageNo = root.pageNo === undefined ? null : integer(root.pageNo);
    const pageSize = root.numOfRows === undefined ? null : integer(root.numOfRows);
    if (pageNo !== null && pageNo !== requestedPage) throw new Error();
    if (pageSize !== null && (pageSize !== 10 || pageSize < rows.length)) throw new Error();
    if (totalCount !== null && totalCount < rows.length) throw new Error();
    if (totalCount !== null && rows.length > Math.max(0, totalCount - (requestedPage - 1) * 10)) throw new Error();
    return { totalCount, pageNo, pageSize };
  });
  if (!rows.length && metadata.totalCount === null) throw new LandPriceValidationError('rows');
  const values = rows.map((row): LandPrice => {
    check('pnu', () => { if (pnu(row.pnu) !== requestedPnu) throw new Error(); });
    const actualYear = check('year', () => {
      if (typeof row.stdrYear !== 'string' || !/^\d{4}$/.test(row.stdrYear)) throw new Error();
      if (year !== undefined && row.stdrYear !== year) throw new Error();
      return row.stdrYear;
    });
    const month = check('month', () => {
      const value = text(row.stdrMt);
      if (row.stdrMt !== undefined && row.stdrMt !== null && row.stdrMt !== '' && (typeof row.stdrMt !== 'string' || value === null || !/^(0[1-9]|1[0-2])$/.test(value))) throw new Error();
      return value;
    });
    return {
      pnu: pnu(row.pnu), year: actualYear, month,
      pricePerSquareMeter: check('price', () => row.pblntfPclnd === undefined || row.pblntfPclnd === null || row.pblntfPclnd === '' ? null : nonNegative(row.pblntfPclnd)),
      publishedAt: check('published-date', () => date(row.pblntfDe)), updatedAt: check('updated-date', () => date(row.lastUpdtDt)),
    };
  });
  // 기준월·공시일·갱신일을 포함한 원본 행의 모든 필드가 같은 경우에만 제거한다.
  // 숫자/문자열 차이, 추가 속성 차이는 보수적으로 서로 다른 행으로 보존한다.
  const exactDuplicate = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
  };
  const records = values.filter((_, index) => !rows.slice(0, index).some((row) => exactDuplicate(row, rows[index])));
  if (!records.length && metadata.totalCount === 0) return { status: 'not-found', message: year === undefined ? '연도 생략 조회 조건의 개별공시지가가 없습니다.' : '해당 연도 개별공시지가가 없습니다.' };
  const completeness = requestedPage > 1 || metadata.totalCount !== null && metadata.totalCount > rows.length ? 'partial'
    : metadata.totalCount !== null && metadata.pageNo !== null && metadata.pageSize !== null ? 'complete' : 'unknown';
  return { status: 'ok', value: { records, returnedCount: rows.length, ...metadata, completeness,
    duplicatesRemoved: rows.length - records.length,
    fields: ['pnu', 'stdrYear', 'stdrMt', 'pblntfPclnd', 'pblntfDe', 'lastUpdtDt'].filter((name) => rows.some((row) => Object.hasOwn(row, name))) } };
}

export async function loadLandPrice(requestedPnu: string, year: string, auth: AttributeAuthentication, signal: AbortSignal): Promise<AttributeState<LandPriceBatch>> {
  try { return parseLandPrice(await requestParcelAttribute('price', requestedPnu, auth, signal, year), requestedPnu, year); }
  catch (error) { return { status: 'error', message: attributeFailure(error) }; }
}

export async function loadLandPricePage(requestedPnu: string, auth: AttributeAuthentication, signal: AbortSignal, pageNo: number): Promise<AttributeState<LandPriceBatch>> {
  try { return parseLandPrice(await requestParcelAttribute('price', requestedPnu, auth, signal, undefined, pageNo), requestedPnu, undefined, pageNo); }
  catch (error) { return { status: 'error', message: attributeFailure(error) }; }
}
