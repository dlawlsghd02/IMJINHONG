import { attributeRows, date, nonNegative, pnu, text, ParcelError } from './parcelValidation';
import type { AttributeState } from './parcelValidation';

export const landLedgerSource = 'https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=128';
export interface LandLedger {
  pnu: string;
  landCategoryCode: string | null;
  landCategoryName: string | null;
  registeredArea: number | null;
  updatedAt: string | null;
}

export function parseLandLedger(payload: unknown, requestedPnu: string): AttributeState<LandLedger> {
  const rows = attributeRows(payload, 'ladfrlVOList', requestedPnu);
  const values = rows.map((row): LandLedger => {
    const code = text(row.lndcgrCode);
    if (code !== null && !/^\d{2}$/.test(code)) throw new ParcelError('지목 코드 형식이 올바르지 않습니다.');
    return {
      pnu: pnu(row.pnu), landCategoryCode: code, landCategoryName: text(row.lndcgrCodeNm),
      registeredArea: row.lndpclAr === undefined || row.lndpclAr === null || row.lndpclAr === '' ? null : nonNegative(row.lndpclAr),
      updatedAt: date(row.lastUpdtDt),
    };
  });
  const unique = [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
  if (!unique.length) return { status: 'not-found', message: '토지임야 속성이 없습니다.' };
  if (unique.length !== 1) throw new ParcelError('동일 PNU의 토지임야 속성이 중복되어 한 행을 선택할 수 없습니다.');
  return { status: 'ok', value: unique[0] };
}

// 전송 규격 검증 전에는 fetch/JSONP 요청을 만들지 않는다.
export async function loadLandLedger(requestedPnu: string): Promise<AttributeState<LandLedger>> {
  pnu(requestedPnu);
  return { status: 'unavailable', message: '조회 불가: 토지임야 API의 브라우저 전송 방식 검증 전입니다.' };
}
