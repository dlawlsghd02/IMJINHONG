import type { AddressSearchCandidate } from './vworld/search';

export interface DisplaySearchCandidate extends AddressSearchCandidate {
  sources: readonly AddressSearchCandidate[];
  positionUncertain: boolean;
  conflictingSourceIndices: readonly number[];
  ranking: SearchRankingEvidence;
}

export interface SearchRankingEvidence {
  exactQuery: number;
  nameMatch: number;
  categoryIntent: number;
  addressCompleteness: number;
  crossTypeAgreement: number;
}

// 동일 유형/ID의 반복 레코드에만 적용하는 보수적 공학 설정. 시설 반경·API 정확도 보장이 아니다.
export const SEARCH_DUPLICATE_DISTANCE_METERS = 10;
// 명칭·주소·분류를 확인한 표시 그룹의 상한. 시설 크기나 동일성을 보장하지 않는다.
export const SEARCH_CATEGORY_GROUP_DISTANCE_METERS = 50;
export const SEARCH_EARTH_RADIUS_METERS = 6371008.8;
export const normalizeSearchText = (value: string | undefined) => (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');

// 지번주소의 실제 토큰과 일치하는 법정동 끝 괄호만 생략한다. 건물 동 표기를 추측하지 않는다.
export function normalizeSearchRoadAddress(value: string | undefined, parcelAddress?: string) {
  const text=normalizeSearchText(value), annotation=text.match(/\s*\(([가-힣][가-힣0-9]*[동리가])\)$/);
  return annotation && normalizeSearchText(parcelAddress).split(' ').includes(annotation[1])
    ? text.slice(0,annotation.index).trim() : text;
}
export function searchRoadAddressesMatch(left: string, right: string, leftParcel?: string, rightParcel?: string) {
  const a=normalizeSearchRoadAddress(left,leftParcel), b=normalizeSearchRoadAddress(right,rightParcel);
  if (!a || !b) return false;
  if (a === b) return true;
  const suffix=(full: string,short: string) => /(?:^|\s)\S+(?:로|길)\s+\d+(?:-\d+)?$/.test(short) && full.endsWith(` ${short}`);
  return suffix(a,b) || suffix(b,a);
}
const categoryParts=(value: string | undefined) => normalizeSearchText(value).split('>').map((part)=>part.trim()).filter(Boolean);
const categoryAncestor=(a: string[],b: string[]) => a.length > 0 && a.length <= b.length && a.every((part,index)=>part===b[index]);
const independentPosition=(item: NormalizedCandidate) => /출입구|출구|입구|승강장|부속|별관|사업장/.test(`${item.name} ${item.raw.placeCategory ?? ''}`);
function compatibleCategories(a: NormalizedCandidate,b: NormalizedCandidate) {
  if (a.raw.kind !== 'place' || b.raw.kind !== 'place') return true;
  const ca=categoryParts(a.raw.placeCategory), cb=categoryParts(b.raw.placeCategory);
  if (!ca.length || !cb.length) return false;
  const genericOffice=(parts: string[]) => parts.length===2 && parts[0]==='건물' && parts[1]==='업무시설';
  return categoryAncestor(ca,cb) || categoryAncestor(cb,ca)
    || (genericOffice(ca) && /기관$/.test(cb[0])) || (genericOffice(cb) && /기관$/.test(ca[0]));
}

export function normalizeSearchCandidate(raw: AddressSearchCandidate, index: number) {
  return { raw, index, name: normalizeSearchText(raw.title), road: normalizeSearchText(raw.roadAddress), parcel: normalizeSearchText(raw.parcelAddress) };
}
type NormalizedCandidate = ReturnType<typeof normalizeSearchCandidate>;
const validPoint = (item: AddressSearchCandidate) => item.location.crs === 'EPSG:4326'
  && Number.isFinite(item.location.longitude) && Number.isFinite(item.location.latitude)
  && Math.abs(item.location.longitude) <= 180 && Math.abs(item.location.latitude) <= 90;

/** 구면 대권거리 근사값(m). EPSG:3857 평면거리를 사용하지 않는다. */
export function searchCandidateDistanceMeters(a: AddressSearchCandidate, b: AddressSearchCandidate): number | null {
  if (!validPoint(a) || !validPoint(b)) return null;
  const radians = Math.PI / 180;
  const latA = a.location.latitude * radians, latB = b.location.latitude * radians;
  const h = Math.sin((latB - latA) / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin((b.location.longitude - a.location.longitude) * radians / 2) ** 2;
  return 2 * SEARCH_EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function assessSearchCandidateIdentity(a: NormalizedCandidate, b: NormalizedCandidate, limit = SEARCH_DUPLICATE_DISTANCE_METERS) {
  const distanceMeters = searchCandidateDistanceMeters(a.raw, b.raw);
  const result = (merge: boolean, reason: string, possible = false) => ({ merge, reason, possible, distanceMeters });
  if (!Number.isFinite(limit) || limit < 0) throw new Error('잘못된 검색 중복 거리 설정입니다.');
  if (distanceMeters === null || !a.raw.id?.trim() || !b.raw.id?.trim()) return result(false, 'invalid-identity-or-coordinate');
  const conflict = (left: string, right: string) => !!left && !!right && left !== right;
  if (conflict(a.name, b.name) || conflict(a.road, b.road) || conflict(a.parcel, b.parcel)) return result(false, 'conflicting-name-or-address');
  const sharedName = !!a.name && a.name === b.name;
  const sharedAddress = (!!a.road && a.road === b.road) || (!!a.parcel && a.parcel === b.parcel);
  const sameTypedId = a.raw.kind === b.raw.kind && a.raw.id === b.raw.id;
  const exactPoint = a.raw.location.longitude === b.raw.location.longitude && a.raw.location.latitude === b.raw.location.latitude;
  if (sameTypedId && (sharedName || sharedAddress)) {
    // 1e-7m는 부동소수점 경계 보정이며 실제 거리 허용 폭을 늘리지 않는다.
    return distanceMeters <= limit + 1e-7 ? result(true, exactPoint ? 'same-id-exact' : 'same-id-nearby') : result(false, 'same-id-spatial-conflict');
  }
  if (a.raw.kind === b.raw.kind) return result(false, 'different-ids', sharedName && sharedAddress && distanceMeters <= limit);
  if (sharedName && sharedAddress && exactPoint) return result(true, 'cross-type-exact');
  return result(false, 'insufficient-facility-evidence', sharedName && sharedAddress && distanceMeters <= limit);
}

/** 후보 그룹 생성 후 모든 구성원 쌍을 검사해 근접 좌표의 연쇄 병합을 막는다. */
export function groupSearchCandidates(items: readonly NormalizedCandidate[], limit = SEARCH_DUPLICATE_DISTANCE_METERS) {
  const groups: NormalizedCandidate[][] = [];
  for (const item of items) {
    const target = groups.find((group) => group.some((member) =>
      (member.raw.kind === item.raw.kind && member.raw.id === item.raw.id)
      || (!!member.name && member.name === item.name && ((!!member.road && member.road === item.road) || (!!member.parcel && member.parcel === item.parcel))))
      && group.every((member) => assessSearchCandidateIdentity(member, item, limit).merge));
    if (target) target.push(item); else groups.push([item]);
  }
  return groups;
}

/** 원본 객체의 동일성과 별개인 표시 묶음. 주소 생략은 완전한 도로명주소 일치로만 보완한다. */
export function assessSearchDisplayIdentity(a: NormalizedCandidate, b: NormalizedCandidate, limit = SEARCH_DUPLICATE_DISTANCE_METERS) {
  const object = assessSearchCandidateIdentity(a, b, limit);
  if (object.merge) return object;
  const result = (merge: boolean, reason: string, possible = false) => ({ merge, reason, possible, distanceMeters: object.distanceMeters });
  const sameName = !!a.name && a.name === b.name;
  const sameRoad = searchRoadAddressesMatch(a.road,b.road,a.parcel,b.parcel);
  const abbreviatedParcel = (full: string, short: string) => /\S+[읍면동리가]\s+(?:산\s*)?\d+(?:-\d+)?$/.test(short)
    && full.endsWith(` ${short}`);
  const parcelMatch = !!a.parcel && !!b.parcel && (a.parcel === b.parcel
    || abbreviatedParcel(a.parcel,b.parcel) || abbreviatedParcel(b.parcel,a.parcel));
  if (!sameName || object.distanceMeters === null
    || !a.raw.id?.trim() || !b.raw.id?.trim()) return result(false, object.reason, object.possible);
  if (independentPosition(a) || independentPosition(b)) return result(false, 'independent-facility-or-entrance');
  // 같은 객체 ID의 위치 충돌은 표시 그룹으로도 덮지 않는다.
  if (a.raw.kind === b.raw.kind && a.raw.id === b.raw.id) return result(false, object.reason);
  if (!compatibleCategories(a,b)) return result(false, 'unconfirmed-category-relationship', sameRoad || parcelMatch);
  const exactRoad = normalizeSearchRoadAddress(a.road,a.parcel) === normalizeSearchRoadAddress(b.road,b.parcel);
  const parcelConflict = !!a.parcel && !!b.parcel && !parcelMatch;
  if (sameRoad && !parcelConflict && (exactRoad || parcelMatch)) {
    if (object.distanceMeters <= SEARCH_CATEGORY_GROUP_DISTANCE_METERS + 1e-7) return result(true, 'display-same-name-road-nearby');
    return result(false, 'display-address-position-conflict', true);
  }
  if (!a.road && !b.road && a.raw.kind === 'place' && b.raw.kind === 'place' && parcelMatch && a.parcel === b.parcel) {
    if (object.distanceMeters <= SEARCH_CATEGORY_GROUP_DISTANCE_METERS + 1e-7) return result(true, 'display-parcel-category-nearby');
    return result(false, 'display-parcel-position-conflict', true);
  }
  return result(false, 'display-insufficient-evidence', true);
}

export function groupSearchDisplayCandidates(objectGroups: readonly NormalizedCandidate[][], limit = SEARCH_DUPLICATE_DISTANCE_METERS) {
  const groups: NormalizedCandidate[][] = [];
  for (const objectGroup of objectGroups) {
    const target = groups.find((group) => group.every((member) => objectGroup.every((item) => assessSearchDisplayIdentity(member,item,limit).merge)));
    if (target) target.push(...objectGroup); else groups.push([...objectGroup]);
  }
  return groups;
}

const priority = { place: 0, road: 1, parcel: 2 };
const exact = (item: NormalizedCandidate, query: string) => !!query && [item.name, item.road, item.parcel].includes(query);
const completeness = (item: NormalizedCandidate) => Number(!!item.raw.id?.trim()) + Number(!!item.name) + Number(!!item.road) + Number(!!item.parcel);

/** 정확 일치 → 정보 완전성 → 유형 → API 순서. 대표 좌표는 원본 중 하나만 선택한다. */
export function selectSearchRepresentative(group: readonly NormalizedCandidate[], query: string) {
  const input = normalizeSearchText(query);
  return [...group].sort((a, b) => Number(exact(b, input)) - Number(exact(a, input))
    || completeness(b) - completeness(a) || priority[a.raw.kind] - priority[b.raw.kind] || a.index - b.index)[0];
}

/** 명칭의 일반 시설 유형과 원본 분류를 함께 확인하는 제한적 관련성 정책. 위치 정확도 판정이 아니다. */
export function searchCategoryMatchesIntent(query: string, category: string | undefined): boolean {
  const input=normalizeSearchText(query), parts=categoryParts(category);
  if (!input || !parts.length) return false;
  // 기관명 전체나 지명을 사용하지 않는다. '시청역', '군청앞약국' 등 뒤에 다른 시설명이 붙으면 적용하지 않는다.
  const administrativeType=input.match(/(?:시청|군청|구청)$/)?.[0];
  if (administrativeType) {
    const explicitTypes=parts.filter((part)=>/^(?:시청|군청|구청)$/.test(part));
    if (explicitTypes.length && !explicitTypes.includes(administrativeType)) return false;
    return parts.includes('지방행정기관') || parts.includes(administrativeType);
  }
  // 다른 시설은 분류 항목 전체와 명칭 끝이 직접 일치하는 경우만 인정한다. 임의의 동의어는 추론하지 않는다.
  return parts.some((part)=>part.length>=2 && input.endsWith(part));
}

/** 표시 순위의 근거이며 실제 시설의 정답 확률이 아니다. 위치 충돌과 중복 레코드 수는 점수에 사용하지 않는다. */
export function scoreSearchGroup(group: readonly NormalizedCandidate[], query: string): SearchRankingEvidence {
  const input=normalizeSearchText(query);
  const exactQuery=Number(group.some((item)=>exact(item,input)));
  const nameMatch=input ? Math.max(...group.map((item)=>item.name===input ? 2
    : input.length>=2 && item.name.startsWith(input) ? 1 : 0)) : 0;
  const categoryIntent=Number(nameMatch===2 && group.some((item)=>item.raw.kind==='place' && item.name===input
    && searchCategoryMatchesIntent(input,item.raw.placeCategory)));
  const fullRoad=(item: NormalizedCandidate)=> /(?:시|군|구)\s/.test(item.road)
    && /\S+(?:로|길)\s+\d+(?:-\d+)?$/.test(normalizeSearchRoadAddress(item.road,item.parcel));
  const fullParcel=(item: NormalizedCandidate)=> /(?:시|군|구)\s/.test(item.parcel)
    && /\S+[읍면동리가]\s+(?:산\s*)?\d+(?:-\d+)?(?:\s*[가-힣]+)?$/.test(item.parcel);
  // 같은 구성원에 실제로 있는 주소만 평가한다. 서로 다른 원본의 주소를 합성하지 않는다.
  const addressCompleteness=Math.max(...group.map((item)=>Number(fullRoad(item))+Number(fullParcel(item))));
  // 실제 표시 그룹에 함께 포함된 쌍만 평가한다. 그룹화와 같은 주소 생략·분류·거리 검사를 재사용한다.
  // 외부 후보와의 좌표 충돌은 경고로 남기되 이 그룹 내부의 일치 근거를 지우지 않는다.
  const crossTypeAgreement=Number(group.some((a,index)=>group.slice(index+1).some((b)=>{
    return a.raw.kind!==b.raw.kind && !!a.name && a.name===b.name && a.name===input
      && searchRoadAddressesMatch(a.road,b.road,a.parcel,b.parcel) && assessSearchDisplayIdentity(a,b).merge;
  })));
  return {exactQuery,nameMatch,categoryIntent,addressCompleteness,crossTypeAgreement};
}

const rankingKeys: readonly (keyof SearchRankingEvidence)[] = ['exactQuery','nameMatch','categoryIntent','addressCompleteness','crossTypeAgreement'];
export function compareSearchRanking(a: SearchRankingEvidence,b: SearchRankingEvidence) {
  for(const key of rankingKeys) if(a[key]!==b[key]) return b[key]-a[key];
  return 0;
}

export function inferSearchFilterIntent(query: string): 'local-administration' | undefined {
  return /(?:시청|군청|구청)$/.test(normalizeSearchText(query)) ? 'local-administration' : undefined;
}

/** 실제 fixture에서 확인한 분류만 강한 제외 근거로 사용한다. 모르는 분류는 불일치로 단정하지 않는다. */
export function classifySearchFilterPlace(item: NormalizedCandidate, query: string): 'related' | 'unrelated' | 'unknown' {
  if (!inferSearchFilterIntent(query) || item.raw.kind!=='place') return 'unknown';
  const parts=categoryParts(item.raw.placeCategory);
  if (!parts.length) return 'unknown';
  if (searchCategoryMatchesIntent(query,item.raw.placeCategory)) return 'related';
  const observedOtherRoots = ['통신판매업','예술품,기념품및장식용품소매업','운송장비용연료소매업','토목건설업','철도시설'];
  if (parts.includes('지방행정기관') || parts.some((part)=>/^(?:시청|군청|구청)$/.test(part))
    || observedOtherRoots.includes(parts[0])) return 'unrelated';
  return 'unknown';
}

/** 전체 원본·그룹은 그대로 두고 표시 자격만 결정한다. 표시 필터가 그룹 병합을 수행하지 않는다. */
export function filterSearchDisplayGroups(all: readonly DisplaySearchCandidate[], items: readonly AddressSearchCandidate[], query: string) {
  const intent=inferSearchFilterIntent(query), normalized=items.map(normalizeSearchCandidate);
  const anchors=intent ? normalized.filter((item)=>classifySearchFilterPlace(item,query)==='related') : [];
  const applied=!!intent && anchors.length>0;
  const decisions=all.map((group,groupIndex)=>{
    if (!applied) return {groupIndex,keep:true,reason:intent ? 'no-related-place-fallback' : 'unsupported-intent-fallback'};
    const members=group.sources.map(normalizeSearchCandidate);
    if (members.some((member)=>classifySearchFilterPlace(member,query)==='related')) return {groupIndex,keep:true,reason:'related-place'};
    if (members.some((member)=>member.raw.kind==='place' && classifySearchFilterPlace(member,query)==='unknown')) {
      return {groupIndex,keep:true,reason:'unknown-place-category-preserved'};
    }
    // 관련 PLACE와 개별적으로 일치해도 다른 주소 후보와의 위치 충돌을 덮어 병합하지 않는다.
    if (members.some((member)=>member.raw.kind!=='place' && anchors.some((anchor)=>assessSearchDisplayIdentity(anchor,member).merge))) {
      return {groupIndex,keep:true,reason:'address-supported-by-related-place'};
    }
    return {groupIndex,keep:false,reason:members.some((member)=>member.raw.kind==='place')
      ? 'confirmed-other-category' : 'address-relevance-unconfirmed'};
  });
  return {eligible:all.filter((_,index)=>decisions[index].keep),filtering:{applied,intent,decisions}};
}

export function prepareSearchCandidates(items: readonly AddressSearchCandidate[], query: string, options: { distanceMeters?: number } = {}) {
  const limit = options.distanceMeters ?? SEARCH_DUPLICATE_DISTANCE_METERS;
  if (!Number.isFinite(limit) || limit < 0) throw new Error('잘못된 검색 중복 거리 설정입니다.');
  const normalized = items.map(normalizeSearchCandidate);
  const objectGroups = groupSearchCandidates(normalized, limit);
  const groups = groupSearchDisplayCandidates(objectGroups, limit);
  const ranked = groups.map((group) => {
    const representative=selectSearchRepresentative(group,query);
    const conflicts=normalized.filter((other)=>!group.some((member)=>member.index===other.index) && group.some((member)=>{
      const distance=searchCandidateDistanceMeters(member.raw,other.raw);
      return !!member.name && member.name===other.name && searchRoadAddressesMatch(member.road,other.road,member.parcel,other.parcel)
        && distance!==null && distance>(member.raw.kind===other.raw.kind && member.raw.id===other.raw.id
          ? SEARCH_DUPLICATE_DISTANCE_METERS : SEARCH_CATEGORY_GROUP_DISTANCE_METERS);
    })).map((other)=>other.index);
    return { group,representative,conflicts,ranking:scoreSearchGroup(group,query) };
  });
  ranked.sort((a,b)=>compareSearchRanking(a.ranking,b.ranking)
    || priority[a.representative.raw.kind]-priority[b.representative.raw.kind] || a.representative.index-b.representative.index);
  const all: DisplaySearchCandidate[] = ranked.map(({group,representative,conflicts,ranking})=>{
    return { ...representative.raw, location: { ...representative.raw.location }, positionUncertain: conflicts.length>0, ranking,
      conflictingSourceIndices: conflicts, sources: group.map(({raw}) => ({ ...raw, location: { ...raw.location } })) };
  });
  const {eligible,filtering}=filterSearchDisplayGroups(all,items,query);
  return { all, eligible, filtering, visible: eligible.slice(0, 5), rawCount: items.length, objectCount: objectGroups.length };
}
