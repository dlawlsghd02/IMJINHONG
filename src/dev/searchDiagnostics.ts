import type { AddressSearchCandidate, AddressSearchResults } from '../services/vworld/search';
import { normalizeSearchCandidate, normalizeSearchText, groupSearchCandidates, assessSearchCandidateIdentity,
  selectSearchRepresentative, prepareSearchCandidates, SEARCH_DUPLICATE_DISTANCE_METERS,
  groupSearchDisplayCandidates, assessSearchDisplayIdentity, SEARCH_CATEGORY_GROUP_DISTANCE_METERS } from '../services/searchCandidates';

/** Allowlisted response fields only. Never accept request URLs, headers, or raw API bodies. */
export function buildSearchDiagnostics(query: string, items: readonly AddressSearchCandidate[], secret = '') {
  const safe = (value: string | undefined) => value === undefined ? undefined : (secret ? value.split(secret).join('[인증정보 생략]').split(encodeURIComponent(secret)).join('[인증정보 생략]') : value)
    .replace(/https?:\/\/\S+/gi, '[URL 생략]').replace(/(?:key|token|callback)\s*=[^\s&]+/gi, '[인증정보 생략]').slice(0, 500);
  const normalized = items.map(normalizeSearchCandidate);
  const objectGroups = groupSearchCandidates(normalized);
  const groups = groupSearchDisplayCandidates(objectGroups);
  const prepared = prepareSearchCandidates(items, query);
  const groupIndex = (index: number) => groups.findIndex((group) => group.some((item) => item.index === index));
  const pairs = [];
  for (let left = 0; left < normalized.length; left++) for (let right = left + 1; right < normalized.length; right++) {
    const a = normalized[left], b = normalized[right];
    if (!(a.raw.kind === b.raw.kind && a.raw.id === b.raw.id)
      && !(a.name && a.name === b.name) && !(a.road && a.road === b.road) && !(a.parcel && a.parcel === b.parcel)) continue;
    const assessment = assessSearchDisplayIdentity(a, b);
    const objectAssessment = assessSearchCandidateIdentity(a, b);
    pairs.push({ leftOriginalIndex: left, rightOriginalIndex: right, distanceMeters: assessment.distanceMeters,
      distanceMethod: 'EPSG:4326 spherical great-circle approximation', pairMergeAllowed: assessment.merge,
      mergedInResult: groupIndex(left) === groupIndex(right), reason: assessment.reason,
      objectMergeAllowed: objectAssessment.merge, objectReason: objectAssessment.reason,
      groupConstraint: assessment.merge && groupIndex(left) !== groupIndex(right) ? 'complete-link-group-constraint' : undefined,
      possibleSameFacilityUnconfirmed: assessment.possible });
  }
  const original = (item: AddressSearchCandidate, index: number) => ({ originalIndex: index,
    typeOrder: items.slice(0,index).filter((other) => other.kind === item.kind).length,
    searchType: item.kind.toUpperCase(), id: safe(item.id), title: safe(item.title),
    roadAddress: safe(item.roadAddress), parcelAddress: safe(item.parcelAddress), placeCategory: safe(item.placeCategory),
    originalPoint: item.rawPoint ? { x: typeof item.rawPoint.x === 'string' ? safe(item.rawPoint.x) : item.rawPoint.x,
      y: typeof item.rawPoint.y === 'string' ? safe(item.rawPoint.y) : item.rawPoint.y } : undefined,
    parsedCoordinate: { crs: item.location.crs, longitude: item.location.longitude, latitude: item.location.latitude } });
  return {
    schema: 'imjinhong-search-diagnostics-v1', query: safe(query), indexConvention: 'zero-based',
    limits: { distanceMeters: SEARCH_DUPLICATE_DISTANCE_METERS, facilityIdentityNotConfirmed: true },
    displayGrouping: { categoryAncestorDistanceMeters: SEARCH_CATEGORY_GROUP_DISTANCE_METERS, objectCount: objectGroups.length,
      meaning: 'display-only-not-confirmed-facility-identity',
      positionConflicts: prepared.all.filter((item)=>item.positionUncertain).map((item)=>({
        representativeOriginalIndex: items.findIndex((source)=>source.kind===item.kind && source.id===item.id
          && source.location.longitude===item.location.longitude && source.location.latitude===item.location.latitude),
        conflictingSourceIndices: item.conflictingSourceIndices, representativeConfidence: 'unverified-original-api-position' })) },
    counts: { before: items.length, after: prepared.all.length, displayed: prepared.visible.length },
    displayFilter: {...prepared.filtering,eligibleGroups:prepared.eligible.length},
    rankedGroups: prepared.all.map((item,rank)=>({rank,representativeOriginalIndex:items.findIndex((source)=>
      source.kind===item.kind && source.id===item.id && source.location.longitude===item.location.longitude
      && source.location.latitude===item.location.latitude), ranking:item.ranking})),
    candidates: items.map(original), pairs,
    groups: groups.map((group, index) => {
      const representative = selectSearchRepresentative(group, query);
      return { groupIndex: index, originalIndices: group.map((item) => item.index), representativeOriginalIndex: representative.index,
        representativeRule: ['exact-query-match','field-completeness','PLACE-ROAD-PARCEL','original-api-order'],
        scores: group.map((item) => ({ originalIndex: item.index,
          exactMatch: !!normalizeSearchText(query) && [item.name,item.road,item.parcel].includes(normalizeSearchText(query)),
          populatedFields: Number(!!item.raw.id?.trim()) + Number(!!item.name) + Number(!!item.road) + Number(!!item.parcel),
          typePriority: item.raw.kind === 'place' ? 0 : item.raw.kind === 'road' ? 1 : 2 })),
      };
    }),
  };
}

export function createSearchDiagnostics(host: HTMLElement, secret: string) {
  const root = document.createElement('details'); root.className = 'search-diagnostics-dev';
  const summary = document.createElement('summary'); summary.textContent = '개발 전용 · 검색 중복 진단';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '진단 복사'; copy.disabled = true;
  const output = document.createElement('textarea'); output.readOnly = true; output.rows = 8;
  output.setAttribute('aria-label', '검색 중복 진단 JSON'); output.style.width = '100%'; output.style.maxWidth = '100%';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '검색 완료 후 진단을 확인할 수 있습니다.';
  root.append(summary,copy,output,status); host.append(root);
  let disposed = false, revision = 0;
  const copied = async () => {
    const token = revision;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(output.value);
      if (!disposed && token === revision) status.textContent = '진단 복사 완료';
    } catch {
      if (!disposed && token === revision) { output.focus(); output.select(); status.textContent = '복사 권한이 없습니다. 선택된 진단 내용을 직접 복사하세요.'; }
    }
  };
  copy.addEventListener('click',copied);
  return { clear() { revision++; output.value = ''; copy.disabled = true; status.textContent = '현재 검색 결과 없음'; },
    update(result: AddressSearchResults) {
      revision++; output.value = JSON.stringify({ ...buildSearchDiagnostics(result.query ?? '',result.items,secret),
        failedSearchTypes: result.failures.map(({kind}) => kind.toUpperCase()), hasMoreOnServer: result.hasNext },null,2);
      copy.disabled = false; status.textContent = '기존 응답만 분석합니다. 별도 API 요청은 없습니다.';
    },
    dispose() { disposed = true; revision++; copy.removeEventListener('click',copied); output.value = ''; root.remove(); },
  };
}
