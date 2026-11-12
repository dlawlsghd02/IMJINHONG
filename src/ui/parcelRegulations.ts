import type { LandUseState } from '../services/vworld/landUse';
import type { RegulationCategory, ClassifiedRegulation } from '../services/vworld/regulationDictionary';

const sections: readonly [RegulationCategory, string][] = [
  ['district','용도지구'], ['zone','용도구역'], ['planning-facility','도시·군계획시설'],
  ['other-designation','기타 지정·규제정보'], ['unclassified','분류 미확인 정보'],
];
export function renderParcelRegulations(host: HTMLElement, state: LandUseState) {
  host.replaceChildren(); host.className = 'parcel-regulations';
  const notice = (value: string) => { const p = document.createElement('p'); p.className = 'parcel-regulation-notice'; p.textContent = value; host.append(p); };
  if (state.status !== 'ok') {
    notice(state.status === 'loading' ? '지정정보 조회 중…' : state.status === 'not-found'
      ? '제공된 지정정보 자료가 없습니다. 지정 여부를 별도로 확인하세요.' : '지정정보 조회가 완료되지 않았습니다. 다시 필지를 선택해 확인하세요.');
    return;
  }
  if (state.value.partial) notice('일부 지정정보만 조회되었습니다. 전체 결과가 아닙니다.');
  const grouped = new Map<RegulationCategory, Map<string, { item: ClassifiedRegulation; count: number }>>();
  let relationIssues = 0;
  for (const item of state.value.classified ?? []) {
    const mismatch = item.issues.includes('relation-mismatch') || item.issues.includes('name-mismatch');
    if (item.issues.includes('relation-mismatch')) relationIssues++;
    // Preserve source records, but never show a touching row as an applicable designation.
    if (item.relationCode === '3') continue;
    const category = mismatch ? 'unclassified' : item.category;
    if (category === 'zoning') continue;
    const items = grouped.get(category) ?? new Map();
    const key = JSON.stringify([item.record.prposAreaDstrcCode, item.record.prposAreaDstrcCodeNm,
      item.relationCode, item.relationName, item.issues]);
    const entry = items.get(key);
    if (entry) entry.count++; else items.set(key, {item,count:1});
    grouped.set(category, items);
  }
  if (relationIssues) notice('관계값 확인이 필요한 기록이 있습니다. 적용 여부를 단정할 수 없습니다.');
  let count = 0;
  for (const [category,label] of sections) {
    const items = grouped.get(category); if (!items?.size) continue;
    const card = document.createElement('details'); card.className = 'parcel-regulation-card';
    const summary = document.createElement('summary'); summary.textContent = `${label} · ${items.size}`; card.append(summary);
    for (const {item,count:records} of items.values()) {
      count++;
      const row = document.createElement('div'); row.className = 'parcel-regulation-row';
      const name = document.createElement('p'); name.textContent = String(item.record.prposAreaDstrcCodeNm);
      const meta = document.createElement('small');
      const relation = item.issues.includes('relation-mismatch') ? '관계 확인 필요' : item.relationName;
      const verification = category === 'unclassified' ? '분류 확인 필요' : '유형 근거 확인';
      meta.textContent = `${String(item.record.prposAreaDstrcCode)} · ${relation} · ${verification}${records > 1 ? ` · 원본 ${records}건` : ''}`;
      row.append(name,meta); card.append(row);
    }
    host.append(card);
  }
  if (!count) notice('조회 자료에서 추가 표시 대상 지정정보가 확인되지 않았습니다. 규제 부재를 의미하지 않습니다.');
}
