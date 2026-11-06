import { attributeRows, date, nonNegative, pnu, text, ParcelError } from './parcelValidation';
import type { AttributeState } from './parcelValidation';

export const landPriceSource = 'https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=25';
export interface LandPrice {
  pnu: string;
  pricePerSquareMeter: number | null;
  year: string;
  month: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export function parseLandPrice(payload: unknown, requestedPnu: string, year: string): AttributeState<LandPrice> {
  if (!/^\d{4}$/.test(year)) throw new ParcelError('조회 기준연도가 올바르지 않습니다.');
  const rows = attributeRows(payload, 'indvdLandPrices', requestedPnu);
  const values = rows.map((row): LandPrice => {
    if (row.stdrYear !== year) throw new ParcelError('공시지가 기준연도가 요청과 다릅니다.');
    const month = text(row.stdrMt);
    if (month !== null && !/^(0[1-9]|1[0-2])$/.test(month)) throw new ParcelError('공시지가 기준월이 올바르지 않습니다.');
    return {
      pnu: pnu(row.pnu), year, month,
      pricePerSquareMeter: row.pblntfPclnd === undefined || row.pblntfPclnd === null || row.pblntfPclnd === '' ? null : nonNegative(row.pblntfPclnd),
      publishedAt: date(row.pblntfDe), updatedAt: date(row.lastUpdtDt),
    };
  });
  const unique = [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
  if (!unique.length) return { status: 'not-found', message: '해당 연도 개별공시지가가 없습니다.' };
  if (unique.length !== 1) throw new ParcelError('기준월 또는 값이 다른 공시지가가 여러 건입니다. 자동 선택하지 않습니다.');
  return { status: 'ok', value: unique[0] };
}

export async function loadLandPrice(requestedPnu: string, year: string): Promise<AttributeState<LandPrice>> {
  pnu(requestedPnu);
  if (!/^\d{4}$/.test(year)) throw new ParcelError('조회 기준연도가 올바르지 않습니다.');
  return { status: 'unavailable', message: `조회 불가: 개별공시지가 API의 브라우저 전송 방식 검증 전입니다. 요청 기준연도 ${year}` };
}
