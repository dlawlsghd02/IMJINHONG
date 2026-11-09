import { attributeRows, date, nonNegative, pnu, text, object, ParcelError } from './parcelValidation';
import type { AttributeState } from './parcelValidation';
import { requestParcelAttribute, attributeFailure } from './attributeRequest';
import type { AttributeAuthentication } from './attributeRequest';

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

export async function loadLandLedger(requestedPnu: string, auth: AttributeAuthentication, signal: AbortSignal): Promise<AttributeState<LandLedger>> {
  try {
    const payload = await requestParcelAttribute('ledger', requestedPnu, auth, signal);
    const result = parseLandLedger(payload, requestedPnu);
    if (result.status === 'not-found') {
      const root = object(object(payload).ladfrlVOList);
      if (String(root.totalCount) !== '0') throw new ParcelError('토지임야 응답의 빈 목록을 검증하지 못했습니다.');
    }
    if (result.status === 'ok' && result.value.landCategoryName) result.value.landCategoryName = result.value.landCategoryName.split(auth.apiKey.trim()).join('[인증정보 제외]').replace(/https?:\/\/\S+/gi, '[URL 제외]');
    return result;
  } catch (error) { return { status: 'error', message: attributeFailure(error) }; }
}
