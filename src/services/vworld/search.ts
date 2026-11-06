// Official Search API 2.0: format=json supports the callback parameter.
// Reference: https://www.vworld.kr/dev/v4dv_search2_s001.do
export type AddressSearchKind = 'road' | 'parcel';

export interface AddressSearchRequest {
  query: string;
  kind: AddressSearchKind;
  page: number;
  size: number;
  // Logical invalidation, not guaranteed network cancellation.
  signal: AbortSignal;
}

export interface AddressSearchItem {
  id: string;
  title?: string;
  roadAddress?: string;
  parcelAddress?: string;
  location: { crs: 'EPSG:4326'; longitude: number; latitude: number };
}

export interface AddressSearchPage {
  items: readonly AddressSearchItem[];
  page: number;
  totalPages?: number;
  totalRecords?: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export type AddressSearchProvider = (request: AddressSearchRequest) => Promise<AddressSearchPage>;

export type SearchErrorKind = 'configuration' | 'input' | 'transport' | 'timeout' | 'response' | 'api';
export class SearchError extends Error {
  constructor(public readonly kind: SearchErrorKind, message: string, public readonly code?: string) {
    super(message);
    this.name = 'SearchError';
  }
}

const endpoint = 'https://api.vworld.kr/req/search';
const timeoutMs = 15_000;
let requestSequence = 0;
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SearchError('response', '검색 응답 구조가 올바르지 않습니다.');
  }
  return value as RecordValue;
}
function number(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new SearchError('response', '검색 응답의 숫자 값이 올바르지 않습니다.');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new SearchError('response', '검색 응답에 유효하지 않은 숫자가 있습니다.');
  return parsed;
}
function integer(value: unknown, minimum: number): number {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new SearchError('response', '검색 응답의 페이지·건수 정보가 올바르지 않습니다.');
  }
  return parsed;
}
function text(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new SearchError('response', '검색 응답의 주소 정보가 올바르지 않습니다.');
  return value.trim() || undefined;
}
function safeApiText(value: unknown, key: string): string {
  if (typeof value !== 'string') return '';
  return value.split(key).join('[키 생략]').split(encodeURIComponent(key)).join('[키 생략]')
    .replace(/https?:\/\/\S+/gi, '[요청 주소 생략]').replace(/[\u0000-\u001f]/g, ' ').slice(0, 250);
}

function parsePage(payload: unknown, request: AddressSearchRequest, key: string): AddressSearchPage {
  const response = object(object(payload).response);
  if (response.status === 'ERROR') {
    const error = object(response.error);
    const candidate = typeof error.code === 'string' ? error.code : '';
    const code = /^[A-Z_]{1,60}$/.test(candidate) ? candidate : 'UNKNOWN_ERROR';
    const detail = safeApiText(error.text, key);
    throw new SearchError('api', `검색 API 오류 (${code})${detail ? `: ${detail}` : ''}`, code);
  }
  if (response.status === 'NOT_FOUND') {
    if (response.record !== undefined) {
      const record = object(response.record);
      if (integer(record.total, 0) !== 0 || integer(record.current, 0) !== 0) {
        throw new SearchError('response', '결과 없음 상태와 검색 건수가 일치하지 않습니다.');
      }
    }
    if (response.page !== undefined) {
      const page = object(response.page);
      integer(page.total, 0);
      integer(page.current, 0);
      integer(page.size, 0);
    }
    return { items: [], page: request.page, hasPrevious: false, hasNext: false };
  }
  if (response.status !== 'OK') throw new SearchError('response', '알 수 없는 검색 응답 상태입니다.');
  const result = object(response.result);
  if (result.crs !== 'EPSG:4326') {
    throw new SearchError('response', '검색 응답 좌표계가 EPSG:4326과 달라 위치 이동을 중단했습니다.');
  }
  if (typeof result.type !== 'string' || result.type.toUpperCase() !== 'ADDRESS' || !Array.isArray(result.items)) {
    throw new SearchError('response', '주소 검색 결과 목록의 형식이 올바르지 않습니다.');
  }
  const record = object(response.record);
  const page = object(response.page);
  const totalRecords = integer(record.total, 0);
  const currentRecords = integer(record.current, 0);
  const totalPages = integer(page.total, 0);
  const currentPage = integer(page.current, 1);
  const pageSize = integer(page.size, 1);
  if (currentPage !== request.page || pageSize > request.size || currentRecords > pageSize || currentRecords !== result.items.length ||
      currentRecords > request.size || totalRecords < currentRecords || currentPage > totalPages) {
    throw new SearchError('response', '검색 응답의 페이지와 결과 건수가 요청과 일치하지 않습니다.');
  }
  const items = result.items.map((raw): AddressSearchItem => {
    const item = object(raw);
    const address = object(item.address);
    if (address.category !== undefined &&
        (typeof address.category !== 'string' || address.category.toUpperCase() !== request.kind.toUpperCase())) {
      throw new SearchError('response', '검색 결과의 주소 유형이 요청과 일치하지 않습니다.');
    }
    const point = object(item.point);
    const longitude = number(point.x);
    const latitude = number(point.y);
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new SearchError('response', '검색 결과 좌표 범위가 올바르지 않아 위치 이동을 중단했습니다.');
    }
    const id = text(item.id);
    const roadAddress = text(address.road);
    const parcelAddress = text(address.parcel);
    if (!id || (!roadAddress && !parcelAddress)) {
      throw new SearchError('response', '검색 결과에 주소 또는 식별자가 없습니다.');
    }
    return { id, title: text(address.bldnm), roadAddress, parcelAddress,
      location: { crs: 'EPSG:4326', longitude, latitude } };
  });
  return { items, page: currentPage, totalPages, totalRecords,
    hasPrevious: currentPage > 1, hasNext: currentPage < totalPages };
}

/** One opaque-origin sandbox per request. No callback is installed on the app window. */
function requestJsonp(url: URL, requestId: string, callback: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Search invalidated', 'AbortError')); return; }
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = '주소 검색 요청';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const literal = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
    // The external script URL is constructed only from the fixed official endpoint.
    frame.srcdoc = `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://api.vworld.kr/req/search; base-uri 'none'; form-action 'none'">
      <script nonce="${nonce}">
      (() => {
        const id = ${literal(requestId)};
        const notify = (type, payload) => parent.postMessage({channel:'imjinhong-search', id, type, payload}, ${literal(window.location.origin)});
        window.addEventListener('error', event => {
          event.preventDefault();
          notify('execution-error', null);
        });
        window[${literal(callback)}] = payload => notify('result', payload);
        const script = document.createElement('script');
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        script.src = ${literal(url.href)};
        script.onerror = () => notify('load-error', null);
        document.head.append(script);
      })();
      <\/script>`;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      // Destroy the callback realm; no permanent/tombstone callbacks remain.
      frame.remove();
    };
    const finish = (error: Error | null, payload?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(payload);
    };
    const abort = () => finish(new DOMException('Search invalidated', 'AbortError'));
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null' || !event.data || typeof event.data !== 'object') return;
      const message = event.data as RecordValue;
      if (message.channel !== 'imjinhong-search' || message.id !== requestId) return;
      if (message.type === 'result') finish(null, message.payload);
      else if (message.type === 'load-error') finish(new SearchError('transport', '검색 스크립트를 불러오지 못했습니다. 네트워크와 서비스 URL 설정을 확인하세요.'));
      else if (message.type === 'execution-error') finish(new SearchError('transport', '검색 응답 스크립트를 처리하지 못했습니다. JSONP 지원과 인증 설정을 확인하세요.'));
    };
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new SearchError('timeout', '검색 응답 시간이 초과되었습니다. 잠시 후 다시 검색하세요.')), timeoutMs);
    try { document.body.append(frame); }
    catch { finish(new SearchError('transport', '검색 요청을 초기화하지 못했습니다.')); }
  });
}

export function createAddressSearchProvider(apiKey: string): AddressSearchProvider {
  return async (request) => {
    const key = apiKey.trim();
    if (!key) throw new SearchError('configuration', 'V-World 검색 인증키가 없습니다.');
    const query = request.query.trim();
    if (!query || !['road', 'parcel'].includes(request.kind) || !Number.isSafeInteger(request.page) || request.page < 1 ||
        !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 1000) {
      throw new SearchError('input', '검색어·주소 유형·페이지 설정을 확인하세요.');
    }
    const id = `${++requestSequence}_${crypto.randomUUID().replaceAll('-', '')}`;
    const callback = `__imjinhong_search_${id}`;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ service: 'search', version: '2.0', request: 'search',
      key, format: 'json', errorFormat: 'json', crs: 'EPSG:4326', type: 'ADDRESS',
      category: request.kind === 'road' ? 'ROAD' : 'PARCEL', query,
      page: String(request.page), size: String(request.size), callback }).toString();
    const payload = await requestJsonp(url, id, callback, request.signal);
    if (request.signal.aborted) throw new DOMException('Search invalidated', 'AbortError');
    return parsePage(payload, request, key);
  };
}
