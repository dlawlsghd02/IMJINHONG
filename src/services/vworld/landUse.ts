import { requestSandboxJsonp } from './sandboxJsonp';
import { object, pnu, integer, date, text, ParcelError } from './parcelValidation';
import type { AttributeAuthentication } from './attributeRequest';

// Limited evidence: official zoning SLD codes + observed upper-level API code.
// This is deliberately not a nationwide exhaustive UQA prefix classifier.
const known = {
  UQA01X: '도시지역', UQA111: '제1종전용주거지역', UQA112: '제2종전용주거지역',
  UQA121: '제1종일반주거지역', UQA122: '제2종일반주거지역', UQA123: '제3종일반주거지역', UQA130: '준주거지역',
  UQA210: '중심상업지역', UQA220: '일반상업지역', UQA230: '근린상업지역', UQA240: '유통상업지역',
  UQA310: '전용공업지역', UQA320: '일반공업지역', UQA330: '준공업지역',
  UQA410: '보전녹지지역', UQA420: '생산녹지지역', UQA430: '자연녹지지역',
  UQB001: '관리지역', UQB100: '계획관리지역', UQB200: '생산관리지역', UQB300: '보전관리지역',
  UQC001: '농림지역', UQD001: '자연환경보전지역',
} as const;
// Exact pairs observed in the approved XML response; not a prefix-based exclusion.
const nonTargets: Record<string, string> = { UQS100: '도로', UQT200: '공원', UQT220: '근린공원', UQV300: '학교',
  UNE200: '대공방어협조구역', UOA100: '교육환경보호구역', UMK600: '(한강)폐기물매립시설 설치제한지역',
  UQQ600: '토지거래계약에관한허가구역', UDT100: '정비구역', UBA100: '과밀억제권역',
  ZQ0001: '중점경관관리구역', UQQ810: '도시자연공원구역', ZA0011: '비오톱1등급', UOA110: '절대보호구역', UOA120: '상대보호구역' };
export interface LandUseDiagnostics {
  zoning: number; nonTarget: number; unknownCode: number; nameMismatch: number; relationMismatch: number; touching: number;
}
export interface LandUseBatch {
  records: Readonly<Record<string, unknown>>[];
  summary: { code: string; name: string; relations: string[] }[];
  total: number; page: number; size: number; partial: boolean; unknown: boolean;
  diagnostics: LandUseDiagnostics;
}
export type LandUseState = { status: 'ok'; value: LandUseBatch } | { status: 'loading' | 'not-found' | 'error'; message: string };
export function parseLandUse(payload: unknown, id: string): LandUseState {
  pnu(id);
  const envelope = object(payload);
  if (envelope.error || envelope.response) throw new ParcelError('토지이용계획 API 오류 또는 미확인 응답입니다.');
  const root = object(envelope.landUses);
  // No guessed success-code mapping: observed data envelope must have no error indication.
  if (text(root.resultCode) !== null || text(root.resultMsg) !== null) throw new ParcelError('토지이용계획 API 상태를 확인할 수 없습니다.');
  const total = integer(root.totalCount), page = integer(root.pageNo), size = integer(root.numOfRows);
  if (page !== 1 || size !== 1000) throw new ParcelError('토지이용계획 페이지 조건이 일치하지 않습니다.');
  const rows = root.field === undefined || root.field === null ? [] : Array.isArray(root.field) ? root.field : [root.field];
  if (rows.length > size || rows.length > total || rows.length !== Math.min(total, size)) throw new ParcelError('토지이용계획 반환 건수가 일치하지 않습니다.');
  const records = rows.map((entry) => {
    const row = object(entry);
    if (pnu(row.pnu) !== id) throw new ParcelError('토지이용계획 PNU가 일치하지 않습니다.');
    for (const key of ['prposAreaDstrcCode', 'prposAreaDstrcCodeNm', 'cnflcAt', 'cnflcAtNm', 'manageNo']) {
      if (typeof row[key] !== 'string' || !row[key] || row[key].length > 200) throw new ParcelError('토지이용계획 필드 형식이 올바르지 않습니다.');
    }
    date(row.registDt); date(row.lastUpdtDt);
    return Object.freeze({ ...row });
  });
  if (!total) return { status: 'not-found', message: '제공된 토지이용계획 자료가 없습니다.' };
  const groups = new Map<string, { code: string; name: string; relations: string[] }>();
  const diagnostics: LandUseDiagnostics = { zoning: 0, nonTarget: 0, unknownCode: 0, nameMismatch: 0, relationMismatch: 0, touching: 0 };
  const relationNames: Record<string, string> = { '1': '포함', '2': '저촉', '3': '접함' };
  for (const row of records) {
    const code = String(row.prposAreaDstrcCode), relation = String(row.cnflcAt);
    if (relationNames[relation] !== row.cnflcAtNm) { diagnostics.relationMismatch++; continue; }
    if (Object.hasOwn(nonTargets, code)) {
      if (nonTargets[code] === row.prposAreaDstrcCodeNm) diagnostics.nonTarget++;
      else diagnostics.nameMismatch++;
      continue;
    }
    if (!Object.hasOwn(known, code)) { diagnostics.unknownCode++; continue; }
    const name = known[code as keyof typeof known];
    if (row.prposAreaDstrcCodeNm !== name) { diagnostics.nameMismatch++; continue; }
    if (relation === '3') { diagnostics.touching++; continue; }
    diagnostics.zoning++;
    const group = groups.get(code) ?? { code, name, relations: [] };
    if (!group.relations.includes(relationNames[relation])) group.relations.push(relationNames[relation]);
    groups.set(code, group);
  }
  for (const [parent, children] of [
    ['UQA01X', ['UQA111','UQA112','UQA121','UQA122','UQA123','UQA130','UQA210','UQA220','UQA230','UQA240','UQA310','UQA320','UQA330','UQA410','UQA420','UQA430']],
    ['UQB001', ['UQB100','UQB200','UQB300']],
  ] as const) {
    const upper = groups.get(parent);
    if (!upper) continue;
    upper.relations = upper.relations.filter((relation) => !children.some((child) => groups.get(child)?.relations.includes(relation)));
    if (!upper.relations.length) groups.delete(parent);
  }
  const unknown = diagnostics.unknownCode + diagnostics.nameMismatch + diagnostics.relationMismatch > 0;
  return { status: 'ok', value: { records, summary: [...groups.values()], total, page, size, partial: total > rows.length, unknown, diagnostics } };
}
export function landUseNotices(value: LandUseBatch): string[] {
  const result: string[] = [];
  if (value.partial) result.push('일부 조회: 전체 지정 정보가 아닙니다.');
  if (value.unknown) result.push(value.summary.length ? '확인된 용도지역을 표시합니다. 일부 항목은 분류를 확인하지 못했습니다.' : '용도지역 분류를 확인하지 못했습니다.');
  if (value.diagnostics.nameMismatch) result.push('코드와 명칭이 일치하지 않는 항목이 있습니다.');
  if (value.diagnostics.relationMismatch) result.push('관계 코드와 명칭이 일치하지 않는 항목이 있습니다.');
  if (!value.summary.length && !value.unknown) result.push(value.diagnostics.touching > 0
    ? '접함 정보만 있으며 포함·저촉 용도지역은 확인되지 않았습니다.'
    : '조회 자료에서 표시 대상 용도지역이 확인되지 않았습니다.');
  return result;
}
export async function loadLandUse(id: string, auth: AttributeAuthentication, signal: AbortSignal): Promise<LandUseState> {
  try {
    pnu(id);
    if (!auth.apiKey.trim() || !auth.domain) throw new Error();
    const domain = new URL(auth.domain);
    if (!['http:', 'https:'].includes(domain.protocol) || domain.username || domain.password || domain.hash || /\s/.test(auth.domain)) throw new Error();
    const params = new URLSearchParams({ pnu: id, key: auth.apiKey.trim(), domain: auth.domain, format: 'json', numOfRows: '1000', pageNo: '1' });
    return parseLandUse(await requestSandboxJsonp('landUse', params, signal), id);
  } catch { return { status: 'error', message: '용도지역 조회 실패: 인증·통신·응답 상태를 확인하세요. 자동 재시도하지 않습니다.' }; }
}
