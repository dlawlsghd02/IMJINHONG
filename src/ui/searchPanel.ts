import type { AddressSearchKind, AddressSearchPage } from '../services/vworld/search';

/** Detached UI. The caller must own insertion and removal. API text never uses innerHTML. */
export function createSearchPanel(
  onSearch: (query: string, kind: AddressSearchKind) => void,
  onInputChange: () => void,
) {
  const panel = document.createElement('section');
  panel.className = 'address-search';
  panel.setAttribute('aria-label', '주소 검색');
  const form = document.createElement('form');
  const typeLabel = document.createElement('label');
  typeLabel.textContent = '주소 유형 ';
  const kind = document.createElement('select');
  for (const [value, label] of [['road', '도로명주소'], ['parcel', '지번주소']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    kind.append(option);
  }
  typeLabel.append(kind);
  const queryLabel = document.createElement('label');
  queryLabel.textContent = '주소 ';
  const query = document.createElement('input');
  query.type = 'search';
  query.autocomplete = 'off';
  query.placeholder = '검색할 주소 입력';
  queryLabel.append(query);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '검색';
  form.append(typeLabel, queryLabel, submit);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = document.createElement('div');
  results.className = 'address-search-results';
  results.hidden = true;
  const controller = new AbortController();
  let resultEvents = new AbortController();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const value = query.value.trim();
    if (!value) { status.textContent = '검색할 주소를 입력하세요.'; status.hidden = false; query.focus(); return; }
    onSearch(value, kind.value === 'parcel' ? 'parcel' : 'road');
  }, { signal: controller.signal });
  // Draft edits invalidate results but never trigger an API request.
  query.addEventListener('input', onInputChange, { signal: controller.signal });
  kind.addEventListener('change', onInputChange, { signal: controller.signal });
  panel.append(form, status, results);
  const clear = () => {
    resultEvents.abort();
    resultEvents = new AbortController();
    results.replaceChildren();
    results.hidden = true;
  };
  return {
    element: panel,
    setUnavailable(message: string) {
      kind.disabled = query.disabled = submit.disabled = true;
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
    render(page: AddressSearchPage, kind: AddressSearchKind, select: () => void) {
      clear();
      panel.setAttribute('aria-busy', 'false');
      submit.textContent = '검색';
      // Use API order only. The first match is not asserted to be unique or intended.
      const item = page.items[0];
      results.hidden = !item;
      status.hidden = !!item;
      status.textContent = item ? '' : '검색 결과가 없습니다.';
      if (item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        const address = kind === 'road'
          ? item.roadAddress ?? item.parcelAddress
          : item.parcelAddress ?? item.roadAddress;
        button.textContent = address ?? '';
        button.title = address ?? '';
        button.addEventListener('click', () => {
          button.setAttribute('aria-pressed', 'true');
          select();
        }, { signal: resultEvents.signal });
        results.append(button);
      }
    },
    dispose() { resultEvents.abort(); controller.abort(); panel.remove(); },
  };
}
