import { zoningNames as known, legacyNonTargets as nonTargets, classifyRegulations, regulationDictionary } from './regulationDictionary';
import type { ClassifiedRegulation } from './regulationDictionary';
import { requestSandboxJsonp } from './sandboxJsonp';
import { object, pnu, integer, date, text, ParcelError } from './parcelValidation';
import type { AttributeAuthentication } from './attributeRequest';

export interface LandUseDiagnostics {
  zoning: number; nonTarget: number; unknownCode: number; nameMismatch: number; relationMismatch: number; touching: number;
}
export interface LandUseBatch {
  records: Readonly<Record<string, unknown>>[];
  summary: { code: string; name: string; relations: string[] }[];
  total: number; page: number; size: number; partial: boolean; unknown: boolean;
  diagnostics: LandUseDiagnostics;
  classified: ClassifiedRegulation[];
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
    const entry = regulationDictionary.find(item => item.code === code);
    if (entry && entry.category !== 'zoning' && entry.category !== 'unclassified' && entry.legalVerification === 'documented-type') {
      if (entry.acceptedNames.includes(String(row.prposAreaDstrcCodeNm))) diagnostics.nonTarget++;
      else diagnostics.nameMismatch++;
      continue;
    }
    if (!Object.hasOwn(known, code) && code !== 'UQA001') { diagnostics.unknownCode++; continue; }
    const name = code === 'UQA001' ? '도시지역' : known[code as keyof typeof known];
    if (row.prposAreaDstrcCodeNm !== name) { diagnostics.nameMismatch++; continue; }
    if (relation === '3') { diagnostics.touching++; continue; }
    diagnostics.zoning++;
    const group = groups.get(code) ?? { code, name, relations: [] };
    if (!group.relations.includes(relationNames[relation])) group.relations.push(relationNames[relation]);
    groups.set(code, group);
  }
  for (const [parent, children] of [
    ['UQA001', ['UQA111','UQA112','UQA121','UQA122','UQA123','UQA130','UQA210','UQA220','UQA230','UQA240','UQA310','UQA320','UQA330','UQA410','UQA420','UQA430']],
    ['UQA01X', ['UQA111','UQA112','UQA121','UQA122','UQA123','UQA130','UQA210','UQA220','UQA230','UQA240','UQA310','UQA320','UQA330','UQA410','UQA420','UQA430']],
    ['UQB001', ['UQB100','UQB200','UQB300']],
  ] as const) {
    const upper = groups.get(parent);
    if (!upper) continue;
    upper.relations = upper.relations.filter((relation) => !children.some((child) => groups.get(child)?.relations.includes(relation)));
    if (!upper.relations.length) groups.delete(parent);
  }
  const unknown = diagnostics.unknownCode + diagnostics.nameMismatch + diagnostics.relationMismatch > 0;
  return { status: 'ok', value: { records, summary: [...groups.values()], total, page, size, partial: total > rows.length, unknown, diagnostics, classified: classifyRegulations(records) } };
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
