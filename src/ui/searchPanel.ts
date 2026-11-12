import type { AddressSearchResults, AddressSearchItem } from '../services/vworld/search';
import { prepareSearchCandidates, normalizeSearchText } from '../services/searchCandidates';
import type { DisplaySearchCandidate } from '../services/searchCandidates';

/** Detached UI. The caller must own insertion and removal. API text never uses innerHTML. */
export function createSearchPanel(
  onSearch: (query: string) => void,
  onInputChange: () => void,
) {
  const panel = document.createElement('section');
  panel.className = 'address-search';
  panel.setAttribute('aria-label', '주소 검색');
  const form = document.createElement('form');
  const queryLabel = document.createElement('label');
  queryLabel.textContent = '장소·주소 검색';
  queryLabel.className = 'search-query-label';
  const query = document.createElement('input');
  query.type = 'search';
  query.autocomplete = 'off';
  query.placeholder = '장소명 또는 주소 입력';
  queryLabel.append(query);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '검색';
  form.append(queryLabel, submit);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = document.createElement('div');
  results.className = 'address-search-results';
  results.setAttribute('role', 'group');
  results.setAttribute('aria-label', '주소 검색 후보');
  results.hidden = true;
  const controller = new AbortController();
  let resultEvents = new AbortController();
  let resultButtons: HTMLButtonElement[] = [];
  let retainedCandidates: readonly DisplaySearchCandidate[] = [];
  let composing = false;
  let compositionSubmitPending = false;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  const inComposition = (event: KeyboardEvent) => composing || event.isComposing || event.keyCode === 229;
  query.addEventListener('compositionstart', () => {
    if (compositionTimer !== undefined) clearTimeout(compositionTimer);
    composing = true; compositionSubmitPending = true; onInputChange();
  }, { signal: controller.signal });
  query.addEventListener('compositionend', () => {
    composing = false; onInputChange();
    // Release even on mobile keyboards that do not emit a final keyup.
    compositionTimer = setTimeout(() => { compositionSubmitPending = false; compositionTimer = undefined; }, 0);
  }, { signal: controller.signal });
  query.addEventListener('keyup', () => {
    if (!composing) compositionSubmitPending = false;
  }, { signal: controller.signal });
  const escape = (event: KeyboardEvent) => {
    if (inComposition(event)) return;
    if (event.key !== 'Escape') return;
    event.preventDefault(); query.focus(); onInputChange();
  };
  panel.addEventListener('keydown', escape, { signal: controller.signal });
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return; }
    if (inComposition(event) || (event.key === 'Enter' && compositionSubmitPending)) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault(); runSearch();
    } else if (event.key === 'ArrowDown' && resultButtons.length) {
      event.preventDefault(); resultButtons[0].focus();
    }
  }, { signal: controller.signal });
  const runSearch = () => {
    if (submit.disabled || composing || compositionSubmitPending) return;
    const value = query.value.trim();
    if (!value) { status.textContent = '검색할 주소를 입력하세요.'; status.hidden = false; query.focus(); return; }
    onSearch(value);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault(); runSearch();
  }, { signal: controller.signal });
  // Draft edits invalidate results but never trigger an API request.
  query.addEventListener('input', onInputChange, { signal: controller.signal });
  panel.append(form, status, results);
  const clear = () => {
    if (results.contains(document.activeElement)) query.focus();
    resultEvents.abort();
    resultEvents = new AbortController();
    results.replaceChildren();
    resultButtons = [];
    retainedCandidates = [];
    results.hidden = true;
  };
  return {
    element: panel,
    setUnavailable(message: string) {
      query.disabled = submit.disabled = true;
      status.textContent = message;
      status.hidden = false;
    },
    setStatus(message: string, loading = false) {
      status.textContent = message;
      status.hidden = !message;
      panel.setAttribute('aria-busy', String(loading));
      submit.textContent = loading ? '다시 검색' : '검색';
    },
    clearResults: clear,
    getCandidates: () => retainedCandidates,
    render(page: AddressSearchResults, select: (item: AddressSearchItem) => void) {
      clear();
      panel.setAttribute('aria-busy', 'false');
      submit.textContent = '검색';
      const prepared = prepareSearchCandidates(page.items, page.query ?? query.value);
      retainedCandidates = prepared.all;
      results.hidden = !prepared.visible.length;
      status.hidden = false;
      const warnings = page.failures.map((failure) => `${failure.kind === 'place' ? '장소' : failure.kind === 'road' ? '도로명' : '지번'} 검색 실패: ${failure.message}`).join(' ');
      status.textContent = prepared.visible.length ? `${prepared.eligible.length > 5 ? `${prepared.eligible.length}개 중 ` : ''}${prepared.visible.length}개 후보 · 위치를 선택하세요.${page.hasNext || prepared.eligible.length > 5 ? ' 일부 결과만 표시합니다.' : ''}${warnings ? ` ${warnings}` : ''}`
        : warnings || '검색 결과가 없습니다.';
      if (prepared.filtering.applied && prepared.eligible.length < prepared.all.length) status.textContent += ` 시설 유형 기준으로 ${prepared.all.length-prepared.eligible.length}개 후보를 화면에서 제외했습니다.`;
      if (prepared.all.some((item)=>item.positionUncertain)) status.textContent += ' 같은 명칭·주소의 서로 다른 위치가 있습니다. 지도 위치를 확인하세요.';
      prepared.visible.forEach((item, index) => {
        const kind = item.kind;
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        const address = kind !== 'parcel'
          ? item.roadAddress ?? item.parcelAddress
          : item.parcelAddress ?? item.roadAddress;
        const addressText = document.createElement('span'); addressText.className = 'search-result-address'; addressText.textContent = kind === 'place' ? item.title ?? '' : address ?? '';
        const detail = document.createElement('span'); detail.className = 'search-result-detail';
        const title = kind === 'place' ? item.title : address;
        const secondary = kind === 'place' ? address : item.title;
        const kinds = [...new Set(item.sources.map((source) => source.kind))];
        detail.textContent = [kinds.map((source) => source === 'place' ? '장소' : source === 'road' ? '도로명' : '지번').join('·'),
          normalizeSearchText(secondary) !== normalizeSearchText(title) ? secondary : undefined,
          item.positionUncertain ? '동일 주소의 위치 차이 · 확인 필요' : undefined].filter(Boolean).join(' · ');
        button.append(addressText, detail);
        button.title = [address, item.title].filter(Boolean).join(' · ');
        button.addEventListener('click', () => {
          resultButtons.forEach((other) => other.setAttribute('aria-pressed', 'false'));
          button.setAttribute('aria-pressed', 'true');
          select(item);
        }, { signal: resultEvents.signal });
        button.addEventListener('keydown', (event) => {
          if (inComposition(event) || (event.key === 'Enter' && event.repeat)) { if (event.key === 'Enter') event.preventDefault(); return; }
          if (event.key === 'Enter') { event.preventDefault(); button.click(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? resultButtons.length - 1
            : Math.max(0, Math.min(resultButtons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          resultButtons[target]?.focus();
        }, { signal: resultEvents.signal });
        resultButtons.push(button);
        results.append(button);
      });
    },
    dispose() {
      if (compositionTimer !== undefined) clearTimeout(compositionTimer);
      retainedCandidates = []; resultButtons = [];
      resultEvents.abort(); controller.abort(); panel.remove();
    },
  };
}
