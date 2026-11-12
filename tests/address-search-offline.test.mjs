import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
// Expose the existing parser only inside this in-memory test bundle.
const bundled = await build({ stdin: { contents: `export { buildSearchDiagnostics, createSearchDiagnostics } from './src/dev/searchDiagnostics'; export * from './src/services/searchCandidates'; export { createSearchPanel } from './src/ui/searchPanel'; export { parsePage, SearchError, createAddressSearchProvider } from './src/services/vworld/search';`,
  resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'offline-parser-access', setup(b) {
    b.onLoad({ filter: /[/\\]vworld[/\\]search\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')) + '\nexport { parsePage };', loader: 'ts' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };

class Element {
  children = []; attributes = new Map(); listeners = new Map(); hidden = false; textContent = ''; value = '';
  style = {};
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attributes.set(k, v); }
  addEventListener(k, fn, options) {
    this.listeners.set(k, fn);
    options?.signal?.addEventListener('abort', () => this.listeners.delete(k), { once: true });
  }
  removeEventListener(k) { this.listeners.delete(k); }
  fire(k, data = {}) { this.listeners.get(k)?.({ preventDefault() {}, ...data }); }
  click() { this.fire('click'); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  focus() { document.activeElement = this; }
  select() { this.selected = true; }
  remove() {}
}
globalThis.document = { createElement: () => new Element(), activeElement: null };
const integrated = (page, kind = 'road', failures = []) => ({ items: page.items.map((item) => ({ ...item, kind })), hasNext: page.hasNext, failures });
const request = (kind = 'road') => ({ query: '대전 서구 52', kind, page: 1, size: 5, signal: new AbortController().signal });
const payload = (count = 5, kind = 'ROAD') => ({ response: {
  status: 'OK', record: { total: count + 2, current: count }, page: { total: 2, current: 1, size: 5 },
  result: { type: 'ADDRESS', crs: 'EPSG:4326', items: Array.from({ length: count }, (_, i) => ({
    id: `candidate-${i}`, address: { category: kind, road: `반환 도로 ${i}`, parcel: `반환 지번 ${i}`, bldnm: i ? `반환 건물 ${i}` : undefined },
    point: { x: 127 + i / 100, y: 36.3 },
  })) },
} });

test('주소검색: 최대 5개 후보 전체 파싱·순서·건물명·좌표 및 지번 유형 보존', () => {
  const page = api.parsePage(payload(), request(), 'offline-key');
  assert.equal(page.items.length, 5); assert.equal(page.hasNext, true);
  assert.deepEqual(page.items.map((item) => item.id), Array.from({ length: 5 }, (_, i) => `candidate-${i}`));
  assert.equal(page.items[0].title, undefined); assert.equal(page.items[4].title, '반환 건물 4');
  assert.equal(page.items[4].location.longitude, 127.04);
  assert.equal(api.parsePage(payload(5, 'PARCEL'), request('parcel'), 'offline-key').items[4].parcelAddress, '반환 지번 4');
});

test('주소검색: 마지막 후보 오류도 거부, 초과 건수·CRS·유형·페이지 오류 차단', () => {
  for (const modify of [
    (p) => { p.response.result.items[4].point.x = 'invalid'; },
    (p) => { p.response.result.items[4].address.category = 'PARCEL'; },
    (p) => { p.response.result.crs = 'EPSG:3857'; },
    (p) => { p.response.result.type = 'PLACE'; },
    (p) => { p.response.record.current = 4; },
    (p) => { p.response.page.current = 2; },
  ]) { const p = payload(); modify(p); assert.throws(() => api.parsePage(p, request(), 'offline-key'), api.SearchError); }
  assert.throws(() => api.parsePage(payload(6), request(), 'offline-key'), api.SearchError);
});

test('주소검색: 결과 없음과 API 오류를 구분하고 인증정보는 정제', () => {
  assert.deepEqual(api.parsePage({ response: { status: 'NOT_FOUND' } }, request(), 'offline-key').items, []);
  assert.throws(() => api.parsePage({ response: { status: 'ERROR', error: { code: 'INVALID_KEY', text: 'offline-key https://example.invalid/?key=offline-key' } } }, request(), 'offline-key'),
    (error) => error.kind === 'api' && error.code === 'INVALID_KEY' && !error.message.includes('offline-key') && !error.message.includes('https://'));
});

test('후보 UI: 5개 표시·자동 선택 없음·선택 항목 전달·단일 선택 표시', () => {
  const selected = [], ui = api.createSearchPanel(() => {}, () => {});
  const page = api.parsePage(payload(), request(), 'offline-key');
  const combined = integrated(page);
  ui.render(combined, (item) => selected.push(item));
  const [, status, results] = ui.element.children;
  assert.equal(results.children.length, 5); assert.equal(selected.length, 0);
  assert.match(status.textContent, /일부 결과/);
  assert.equal(results.children[4].children[0].textContent, '반환 도로 4');
  assert.equal(results.children[4].children[1].textContent, '도로명 · 반환 건물 4');
  results.children[4].fire('click'); assert.equal(selected[0].id, combined.items[4].id);
  assert.deepEqual(selected[0].location, combined.items[4].location);
  results.children[1].fire('click'); assert.equal(selected[1].id, combined.items[1].id);
  assert.equal(results.children[4].attributes.get('aria-pressed'), 'false');
  assert.equal(results.children[1].attributes.get('aria-pressed'), 'true');
  const previous = results.children[1]; ui.clearResults(); previous.fire('click'); assert.equal(selected.length, 2);
  assert.equal(results.hidden, true); ui.dispose();
});

test('후보 UI: 지번·건물명 누락·키보드 이동·Escape·빈 결과·로딩 상태', () => {
  let edits = 0;
  const ui = api.createSearchPanel(() => {}, () => { edits++; ui.clearResults(); });
  const page = api.parsePage(payload(5, 'PARCEL'), request('parcel'), 'offline-key');
  ui.render(integrated(page, 'parcel'), () => {});
  const [form, status, results] = ui.element.children, query = form.children[0].children[0];
  assert.equal(results.children[0].children[0].textContent, '반환 지번 0');
  assert.equal(results.children[0].children[1].textContent, '지번');
  query.fire('keydown', { key: 'ArrowDown' }); assert.equal(document.activeElement, results.children[0]);
  results.children[0].fire('keydown', { key: 'End' }); assert.equal(document.activeElement, results.children[4]);
  results.children[4].fire('keydown', { key: 'ArrowUp' }); assert.equal(document.activeElement, results.children[3]);
  results.children[3].fire('keydown', { key: 'Home' }); assert.equal(document.activeElement, results.children[0]);
  ui.element.fire('keydown', { key: 'Escape' }); assert.equal(edits, 1); assert.equal(results.hidden, true); assert.equal(document.activeElement, query);
  ui.render({ items: [], hasNext: false, failures: [] }, () => {});
  assert.equal(status.textContent, '검색 결과가 없습니다.');
  ui.setStatus('주소 검색 중…', true); assert.equal(ui.element.attributes.get('aria-busy'), 'true');
  ui.dispose(); assert.equal(query.listeners.size, 0); document.activeElement = null;
});

test('검색 지도 연결: 5개 요청·선택한 후보만 이동·입력 변경 후 늦은 응답 차단', async () => {
  const requests = [], placeRequests = [], moves = [], layers = [], host = new Element();
  const built = await build({ stdin: { contents: `export { addressSearchFeature } from './src/features/addressSearch';`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'offline-provider', setup(b) {
      b.onLoad({ filter: /[/\\]vworld[/\\]search\.ts$/ }, () => ({ loader: 'ts', contents: `
        export class SearchError extends Error {}
        export const createAddressSearchProvider = () => request => globalThis.addressSearchOffline(request);
      ` }));
    } }],
  });
  const feature = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  globalThis.addressSearchOffline = (request) => {
    if (request.kind === 'place') {
      placeRequests.push(request);
      return Promise.resolve({ items: [], page: 1, hasPrevious: false, hasNext: false });
    }
    return new Promise((resolve, reject) => requests.push({ request, resolve, reject }));
  };
  const view = { getProjection: () => ({ getExtent: () => [-20037508, -20037508, 20037508, 20037508] }),
    cancelAnimations() {}, getMaxZoom: () => 19, animate: (value) => moves.push(value) };
  const dispose = feature.addressSearchFeature.mount({ map: { addLayer: (layer) => layers.push(layer), removeLayer() {}, getView: () => view },
    searchHost: host, vworldApiKey: 'offline-key' });
  try {
    const [form, , results] = host.children[0].children;
    const query = form.children[0].children[0]; query.value = '대전 서구 52';
    form.fire('submit'); assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({request}) => [request.kind, request.page, request.size]), [['road',1,5],['parcel',1,5]]);
    assert.equal(requests[0].request.signal, requests[1].request.signal);
    assert.equal(placeRequests[0].signal, requests[0].request.signal);
    assert.equal(placeRequests[0].size, 5);
    const page = api.parsePage(payload(), request(), 'offline-key');
    requests[1].resolve(page); await new Promise(setImmediate); assert.equal(results.children.length, 0);
    requests[0].resolve(page); await new Promise(setImmediate);
    assert.equal(moves.length, 0); assert.equal(results.children.length, 5);
    assert.match(results.children[4].children[1].textContent, /도로명/);
    assert.match(results.children[1].children[1].textContent, /지번/);
    results.children[4].fire('click'); assert.equal(moves.length, 1);
    assert.equal(moves[0].zoom, 18);
    assert.ok(Math.abs(moves[0].center[0] - page.items[4].location.longitude * 20037508.342789244 / 180) < 0.01);
    assert.equal(layers[0].getSource().getFeatures().length, 1);
    form.fire('submit'); query.fire('input');
    assert.ok(requests.slice(2).every(({request}) => request.signal.aborted));
    requests[2].resolve(page); requests[3].resolve(page); await new Promise(setImmediate);
    assert.equal(results.children.length, 0); assert.equal(moves.length, 1);
    assert.equal(layers[0].getSource().getFeatures().length, 0);
    // An identical source item remains a separate candidate for each search type.
    const status = host.children[0].children[1];
    const empty = { items: [], page: 1, hasPrevious: false, hasNext: false };
    const run = () => { const offset = requests.length; form.fire('submit'); return requests.slice(offset); };
    let pair = run(); pair[0].reject(new Error('offline failure')); pair[1].resolve(page); await new Promise(setImmediate);
    assert.equal(results.children.length, 5); assert.match(status.textContent, /도로명 검색 실패/);
    assert.match(results.children[0].children[1].textContent, /지번/);
    results.children[0].fire('click'); assert.match(status.textContent, /도로명 검색 실패/);
    pair = run(); pair[0].resolve(page); pair[1].reject(new Error('offline failure')); await new Promise(setImmediate);
    assert.equal(results.children.length, 5); assert.match(status.textContent, /지번 검색 실패/);
    assert.match(results.children[0].children[1].textContent, /도로명/);
    pair = run(); pair[0].resolve(empty); pair[1].resolve(empty); await new Promise(setImmediate);
    assert.equal(status.textContent, '검색 결과가 없습니다.'); assert.equal(results.hidden, true);
    pair = run(); pair[0].resolve(empty); pair[1].reject(new Error('offline failure')); await new Promise(setImmediate);
    assert.match(status.textContent, /지번 검색 실패/); assert.doesNotMatch(status.textContent, /검색 결과가 없습니다/);
    pair = run(); pair[0].reject(new Error('offline failure')); pair[1].reject(new Error('offline failure')); await new Promise(setImmediate);
    assert.match(status.textContent, /도로명 검색 실패/); assert.match(status.textContent, /지번 검색 실패/);
    assert.doesNotMatch(status.textContent, /검색 결과가 없습니다/);
    const old = run(), latest = run();
    latest[0].resolve(empty); latest[1].resolve(empty); await new Promise(setImmediate);
    old[0].resolve(page); old[1].resolve(page); await new Promise(setImmediate);
    assert.equal(status.textContent, '검색 결과가 없습니다.'); assert.equal(results.hidden, true);
    assert.equal(requests.length, 18); // Nine explicit submits, exactly two requests each.
    assert.equal(placeRequests.length, 9); // Plus exactly one PLACE request per submit.
  } finally { dispose(); delete globalThis.addressSearchOffline; }
});

test('IME: 조합 중 Enter·229·조합 확정 submit 차단, 키 해제 후 수동 검색 유지', () => {
  const searches = []; let edits = 0;
  const ui = api.createSearchPanel((query) => searches.push(query), () => { edits++; ui.clearResults(); });
  const [form] = ui.element.children, query = form.children[0].children[0]; query.value = '서울';
  query.fire('compositionstart'); form.fire('submit'); assert.equal(searches.length, 0);
  let prevented = 0;
  query.fire('keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  query.fire('compositionend'); form.fire('submit'); assert.equal(searches.length, 0);
  query.fire('keyup', { key: 'Enter' }); form.fire('submit'); assert.deepEqual(searches, ['서울']);
  query.fire('keydown', { key: 'Enter', keyCode: 229, preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(edits, 2); // No automatic request is introduced while its policy is unverified.
  ui.dispose();
});

test('모바일 IME: keyup 없는 조합 완료도 이후 검색 버튼을 차단하지 않음', async () => {
  const searches = [], ui = api.createSearchPanel((query) => searches.push(query), () => {});
  const [form] = ui.element.children, query = form.children[0].children[0]; query.value = '대전';
  query.fire('compositionstart'); query.fire('compositionend'); form.fire('submit');
  assert.equal(searches.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  form.fire('submit'); assert.deepEqual(searches, ['대전']); ui.dispose();
});

const placePayload = () => {
  const p = payload(); p.response.result.type = 'place';
  p.response.result.items.forEach((item, i) => {
    item.title = `반환 장소 ${i}`; item.category = '공공기관'; delete item.address.category;
    if (i === 0) item.address = { road: '', parcel: '' };
  });
  return p;
};

test('PLACE: title·id·좌표 필수, 빈 주소 허용, ADDRESS와 유형 분리', () => {
  const page = api.parsePage(placePayload(), request('place'), 'offline-key');
  assert.equal(page.items.length, 5); assert.equal(page.items[0].title, '반환 장소 0');
  assert.equal(page.items[0].roadAddress, undefined); assert.equal(page.items[4].id, 'candidate-4');
  for (const mutate of [
    (p) => { delete p.response.result.items[0].title; },
    (p) => { delete p.response.result.items[0].id; },
    (p) => { p.response.result.items[0].point.x = 999; },
    (p) => { p.response.result.type = 'ADDRESS'; },
  ]) { const p = placePayload(); mutate(p); assert.throws(() => api.parsePage(p, request('place'), 'offline-key')); }
});

test('PLACE JSONP 모의 전송: category 생략·고유 callback·기존 sandbox/CSP/메시지 검증', async () => {
  const originalDocument = globalThis.document, originalWindow = globalThis.window;
  const handlers = new Map(); let frame;
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173' }, addEventListener: (k, fn) => handlers.set(k, fn), removeEventListener: (k) => handlers.delete(k) };
  globalThis.document = { createElement: () => Object.assign(new Element(), { contentWindow: {}, remove() { this.removed = true; } }),
    body: { append(value) { frame = value; } } };
  try {
    const pending = api.createAddressSearchProvider('offline-key')(request('place'));
    assert.equal(frame.attributes.get('sandbox'), 'allow-scripts');
    assert.match(frame.srcdoc, /default-src 'none'/); assert.match(frame.srcdoc, /script-src 'nonce-/);
    assert.doesNotMatch(frame.srcdoc, /allow-same-origin/);
    const url = new URL(JSON.parse(frame.srcdoc.match(/script\.src = ("[^\n]+?");/)[1]));
    assert.equal(url.origin + url.pathname, 'https://api.vworld.kr/req/search');
    assert.equal(url.searchParams.get('type'), 'PLACE'); assert.equal(url.searchParams.has('category'), false);
    assert.equal(url.searchParams.get('size'), '5'); assert.equal(url.searchParams.get('crs'), 'EPSG:4326');
    assert.match(url.searchParams.get('callback'), /^__imjinhong_search_/);
    const id = JSON.parse(frame.srcdoc.match(/const id = ("[^\n]+?");/)[1]);
    const message = { channel: 'imjinhong-search', id, type: 'result', payload: placePayload() };
    handlers.get('message')({ source: {}, origin: 'null', data: message }); assert.equal(frame.removed, undefined);
    handlers.get('message')({ source: frame.contentWindow, origin: 'https://wrong.invalid', data: message }); assert.equal(frame.removed, undefined);
    handlers.get('message')({ source: frame.contentWindow, origin: 'null', data: message });
    const result = await pending; assert.equal(result.items.length, 5);
    assert.equal(frame.removed, true); assert.equal(handlers.size, 0);
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});

test('3유형 지도 연결: 원본 최대 15개·표시 5개, 장소 선택 및 늦은 PLACE 응답 차단', async () => {
  const calls = [], moves = [], host = new Element(), layers = [];
  const built = await build({ stdin: { contents: `export { addressSearchFeature } from './src/features/addressSearch';`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'three-types', setup(b) {
      b.onLoad({ filter: /[/\\]vworld[/\\]search\.ts$/ }, () => ({ loader: 'ts', contents: `export class SearchError extends Error {} export const createAddressSearchProvider = () => request => globalThis.threeTypeSearch(request);` }));
    } }],
  });
  const feature = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  globalThis.threeTypeSearch = (request) => new Promise((resolve, reject) => calls.push({ request, resolve, reject }));
  const view = { getProjection: () => ({ getExtent: () => [-20037508,-20037508,20037508,20037508] }), getMaxZoom: () => 19, cancelAnimations() {}, animate: (value) => moves.push(value) };
  const dispose = feature.addressSearchFeature.mount({ map: { addLayer: (layer) => layers.push(layer), removeLayer() {}, getView: () => view }, searchHost: host, vworldApiKey: 'offline-key' });
  try {
    const [form, status, results] = host.children[0].children, input = form.children[0].children[0]; input.value = '서울시청';
    let prevented = false;
    input.fire('keydown', {key:'Enter',preventDefault() { prevented = true; }});
    assert.equal(prevented, true);
    assert.deepEqual(calls.map(({request}) => [request.kind,request.size]), [['place',5],['road',5],['parcel',5]]);
    const places = api.parsePage(placePayload(), request('place'), 'offline-key');
    const addresses = api.parsePage(payload(), request(), 'offline-key');
    calls[2].resolve(addresses); calls[1].resolve(addresses); await new Promise(setImmediate); assert.equal(results.hidden, true);
    calls[0].resolve(places); await new Promise(setImmediate);
    assert.equal(results.children.length, 5); assert.equal(moves.length, 0);
    assert.equal(results.children[0].children[0].textContent, '반환 장소 0');
    assert.equal(results.children[0].children[1].textContent, '장소');
    assert.equal(results.children[4].children[0].textContent, '반환 장소 4');
    assert.match(status.textContent, /일부 결과/);
    results.children[0].fire('click'); assert.equal(moves.length, 1); assert.equal(layers[0].getSource().getFeatures().length, 1);
    form.fire('submit'); calls[3].reject(new Error('offline')); calls[4].resolve(addresses); calls[5].resolve(addresses); await new Promise(setImmediate);
    assert.equal(results.children.length, 5); assert.match(status.textContent, /장소 검색 실패/);
    form.fire('submit'); input.fire('input'); calls[6].resolve(places); calls[7].resolve(addresses); calls[8].resolve(addresses); await new Promise(setImmediate);
    assert.equal(results.hidden, true); assert.equal(moves.length, 1);
  } finally { dispose(); delete globalThis.threeTypeSearch; }
});

const candidate = (overrides = {}) => ({ id: 'same-id', kind: 'place', title: '서울시청', roadAddress: '서울 중구 세종대로 110', parcelAddress: '서울 중구 태평로1가 31',
  location: { crs: 'EPSG:4326', longitude: 126.978, latitude: 37.566 }, ...overrides });

test('표시 중복: 동일 유형·ID·검증 필드 일치만 병합, 충돌 ID는 보존', () => {
  const first = candidate();
  const duplicate = candidate({ title: ' 서울시청 ', roadAddress: '서울  중구 세종대로 110' });
  const conflict = candidate({ title: '다른 시청 별관' });
  const result = api.prepareSearchCandidates([first, duplicate, conflict], '');
  assert.equal(result.all.length, 2); assert.equal(result.all[0].sources.length, 2);
  assert.equal(result.all[1].title, conflict.title);
});

test('표시 중복: 유형이 달라도 명칭·두 주소 필드·좌표 일치 시 출처 보존', () => {
  const result = api.prepareSearchCandidates([candidate(), candidate({ kind: 'road', id: 'road-id' }), candidate({ kind: 'parcel', id: 'parcel-id' })], '');
  assert.equal(result.all.length, 1);
  assert.deepEqual(result.all[0].sources.map(({kind,id}) => ({kind,id})), [{kind:'place',id:'same-id'}, {kind:'road',id:'road-id'}, {kind:'parcel',id:'parcel-id'}]);
  assert.deepEqual(result.all[0].sources[0], candidate());
});

test('표시 중복: 동명·동좌표·다른 주소·다른 식별자·부족한 정보는 보수적으로 보존', () => {
  for (const other of [
    candidate({ id: 'other', roadAddress: '다른 도로 1' }),
    candidate({ id: 'other', title: '다른 건물' }),
    candidate({ id: 'other', location: {crs:'EPSG:4326',longitude:127,latitude:37} }),
    candidate({ id: 'other' }), // Same type with a different authoritative ID.
    candidate({ id: '', kind: 'road' }),
    candidate({ kind: 'parcel', title: undefined }),
    candidate({ kind: 'parcel', roadAddress: undefined, parcelAddress: '지번 1' }),
  ]) assert.equal(api.prepareSearchCandidates([candidate(), other], '').all.length, 2);
  assert.equal(api.prepareSearchCandidates([candidate({title:undefined,roadAddress:undefined,parcelAddress:undefined}), candidate({title:undefined,roadAddress:undefined,parcelAddress:undefined})], '').all.length, 2);
});

test('표시 순위: 정확 일치 주소·주소 완전성 우선, 근거가 동률이면 유형 및 API 순서 유지', () => {
  const places = Array.from({length:5}, (_,i) => candidate({id:`place-${i}`,title:`장소 ${i}`}));
  const road = candidate({kind:'road',id:'exact-road',title:undefined});
  const parcel = candidate({kind:'parcel',id:'parcel',title:undefined,roadAddress:undefined});
  const all = [...places, road, parcel];
  const result = api.prepareSearchCandidates(all, ' 서울  중구 세종대로 110 ');
  // All places also expose that exact address: preserve type priority in a real tie.
  assert.equal(result.visible[0].kind, 'place');
  const notMatchingPlaces = places.map((item) => ({...item,roadAddress:'다른 도로',parcelAddress:undefined}));
  const ranked = api.prepareSearchCandidates([...notMatchingPlaces,road,parcel], '서울 중구 세종대로 110');
  assert.equal(ranked.visible.length, 5); assert.equal(ranked.all.length, 7);
  assert.equal(ranked.visible[0].id, 'exact-road');
  // 완전한 지번주소를 불완전한 PLACE보다 우선한다. 동률 PLACE의 원본 순서는 유지한다.
  assert.deepEqual(ranked.visible.slice(1).map((item) => item.id), ['parcel','place-0','place-1','place-2']);
  const noExact = api.prepareSearchCandidates([parcel,road,...places], '미일치');
  assert.deepEqual(noExact.all.map((item) => item.kind), ['place','place','place','place','place','road','parcel']);
});

test('표시 중복: API 원본 불변·5개 미만 추가 생성 없음·전체 내부 후보 보존', () => {
  const items = Array.from({length:8}, (_,i) => candidate({id:`id-${i}`,title:`장소 ${i}`}));
  const before = structuredClone(items); items.forEach((item) => { Object.freeze(item.location); Object.freeze(item); }); Object.freeze(items);
  const prepared = api.prepareSearchCandidates(items, ''); assert.equal(prepared.all.length, 8); assert.equal(prepared.visible.length, 5);
  assert.deepEqual(items, before);
  const ui = api.createSearchPanel(() => {}, () => {});
  ui.render({items,hasNext:false,failures:[{kind:'road',message:'시간 초과'}]}, () => {});
  assert.equal(ui.element.children[2].children.length, 5); assert.equal(ui.getCandidates().length, 8);
  assert.match(ui.element.children[1].textContent, /도로명 검색 실패/);
  ui.clearResults(); assert.equal(ui.getCandidates().length, 0); ui.dispose();
  assert.equal(api.prepareSearchCandidates([candidate(), candidate()], '').visible.length, 1);
});

test('Enter·버튼: 동일 경로·미강조 Enter 검색·강조 후보 Enter 선택·반복 키 차단', () => {
  const searches = [], selected = [], ui = api.createSearchPanel((query) => searches.push(query), () => ui.clearResults());
  const [form,,results] = ui.element.children, input = form.children[0].children[0]; input.value = '서울시청';
  let prevented = false;
  input.fire('keydown', {key:'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true); assert.deepEqual(searches, ['서울시청']);
  form.fire('submit'); assert.deepEqual(searches, ['서울시청','서울시청']); // Native button submits the same form.
  ui.render({items:[candidate()],hasNext:false,failures:[]}, (item) => selected.push(item));
  input.fire('keydown', {key:'ArrowDown'}); assert.equal(document.activeElement, results.children[0]);
  results.children[0].fire('keydown', {key:'Enter'}); assert.equal(selected.length, 1); assert.equal(searches.length, 2);
  results.children[0].fire('keydown', {key:'Enter',repeat:true}); assert.equal(selected.length, 1);
  input.fire('keydown', {key:'Enter',repeat:true}); assert.equal(searches.length, 2);
  ui.element.fire('keydown', {key:'Escape'}); assert.equal(results.hidden, true);
  ui.dispose(); document.activeElement = null;
});

test('후보 보조 정보: 제목과 같은 문자열 반복 방지, 합쳐진 유형 표시', () => {
  const ui = api.createSearchPanel(() => {}, () => {});
  ui.render({items:[candidate({title:'서울 중구 세종대로 110'}),candidate({kind:'road',title:'서울 중구 세종대로 110'})],hasNext:false,failures:[]}, () => {});
  const results = ui.element.children[2];
  assert.equal(results.children.length, 1); assert.equal(results.children[0].children[1].textContent, '장소·도로명'); ui.dispose();
});

// 다음 지명 사례는 실제 API 응답이 아닌 동일성 규칙 검증용 가상 데이터다.
const northMeters = (item, meters) => ({ ...item, location: { ...item.location,
  latitude: item.location.latitude + meters / api.SEARCH_EARTH_RADIUS_METERS * 180 / Math.PI } });
const identity = (a, b, limit) => api.assessSearchCandidateIdentity(api.normalizeSearchCandidate(a, 0), api.normalizeSearchCandidate(b, 1), limit);

test('가상 장수군청: 동일 유형·ID·주소의 8m 편차는 병합, 다른 ID의 근접 객체는 보존', () => {
  const original = candidate({id:'synthetic-office',title:'장수군청',roadAddress:'가상 도로 1',parcelAddress:undefined});
  const repeated = northMeters(original, 8), unknown = northMeters({...original,id:'different-poi'}, 4);
  const result = api.prepareSearchCandidates([original,repeated,unknown], '장수군청');
  assert.equal(result.all.length, 2); assert.equal(result.all[0].sources.length, 2);
  assert.deepEqual(result.all[0].sources, [original,repeated]);
  assert.equal(identity(original,repeated).reason, 'same-id-nearby');
  assert.equal(identity(original,unknown).merge, false); assert.equal(identity(original,unknown).possible, true);
});

test('가상 서울시청·대전역: 단일 시설 보존, 출입구·입주기관·전국 동명 시설 분리', () => {
  const city = candidate(); assert.equal(api.prepareSearchCandidates([city], '서울시청').all.length, 1);
  const station = candidate({id:'station',title:'대전역'});
  const entrance = northMeters(candidate({id:'entrance',title:'대전역 출입구'}), 2);
  const tenant = candidate({id:'tenant',title:'별도 입주기관'});
  assert.equal(api.prepareSearchCandidates([station,entrance,tenant], '대전역').all.length, 3);
  const distant = northMeters(station, 5000);
  assert.equal(identity(station,distant).merge, false); // Even a reused ID cannot bridge distant coordinates.
  assert.equal(api.prepareSearchCandidates([station,distant], '대전역').all.length, 2);
});

test('도로명·지번: 같은 문자열이나 근접 좌표만으로 병합하지 않고 정확 객체 일치만 허용', () => {
  const road = candidate({kind:'road',id:'road-record'}), parcel = candidate({kind:'parcel',id:'parcel-record'});
  assert.equal(identity(road,parcel).merge, true);
  assert.equal(identity(road,northMeters(parcel,1)).merge, false);
  const missingBridge = {...parcel,roadAddress:undefined,parcelAddress:'다른 지번'};
  assert.equal(identity(road,missingBridge).merge, false);
  const unnamed = {...road,title:undefined}, unnamedParcel = {...parcel,title:undefined};
  assert.equal(identity(unnamed,unnamedParcel).merge, false);
  assert.equal(api.prepareSearchCandidates([unnamed,unnamedParcel], road.roadAddress).all.length, 2);
});

test('거리: EPSG:4326 대권거리(m), 10m 경계·설정값·잘못된 좌표·타원체 한계 구분', () => {
  const origin = candidate();
  assert.equal(api.SEARCH_DUPLICATE_DISTANCE_METERS, 10);
  assert.ok(Math.abs(api.searchCandidateDistanceMeters(origin,northMeters(origin,10)) - 10) < 1e-6);
  assert.equal(identity(origin,northMeters(origin,9.99)).merge, true);
  assert.equal(identity(origin,northMeters(origin,10)).merge, true);
  assert.equal(identity(origin,northMeters(origin,10.01)).merge, false);
  assert.equal(identity(origin,northMeters(origin,10.01),11).merge, true);
  assert.equal(api.prepareSearchCandidates([origin,northMeters(origin,2)], '', {distanceMeters:0}).all.length, 2);
  assert.equal(api.searchCandidateDistanceMeters(origin,{...origin,location:{...origin.location,crs:'EPSG:3857'}}),null);
  assert.equal(api.searchCandidateDistanceMeters(origin,{...origin,location:{...origin.location,latitude:91}}),null);
  assert.throws(() => api.prepareSearchCandidates([origin], '', {distanceMeters:-1}));
});

test('연쇄 병합 방지: A-B 8m·B-C 8m여도 A-C 16m이면 같은 그룹으로 합치지 않음', () => {
  const a = candidate(), b = northMeters(a,8), c = northMeters(a,16);
  const result = api.prepareSearchCandidates([a,b,c], '');
  assert.equal(result.all.length, 2); assert.equal(result.all[0].sources.length, 2);
});

test('대표 후보: 정보 완전성과 정확 일치·유형·API 순서, 좌표는 원본 중 하나', () => {
  const sparse = candidate({title:undefined,parcelAddress:undefined});
  const full = northMeters(candidate(), 4);
  const source = [sparse, full], before = structuredClone(source);
  const result = api.prepareSearchCandidates(source, '서울시청');
  assert.equal(result.all.length, 1); assert.deepEqual(result.all[0].location, full.location);
  assert.deepEqual(result.all[0].sources, before); assert.deepEqual(source,before);
  const exactSparse = api.prepareSearchCandidates(source, sparse.roadAddress);
  assert.deepEqual(exactSparse.all[0].location, full.location); // Both exact: more complete record wins.
  const ui = api.createSearchPanel(() => {}, () => {}); let selected;
  ui.render({items:source,query:'서울시청',hasNext:false,failures:[]}, (item) => { selected=item; });
  ui.element.children[2].children[0].fire('click'); assert.deepEqual(selected.location, full.location);
  ui.dispose();
});

test('진단: 실제 필드·원본 좌표 문자열·장소 분류 보존, 미제공 필드는 만들지 않음', () => {
  const p = placePayload();
  p.response.result.items[0].point = {x:'126.978000',y:'37.566000'};
  const page = api.parsePage(p,request('place'),'offline-key');
  assert.deepEqual(page.items[0].rawPoint,{x:'126.978000',y:'37.566000'});
  assert.equal(page.items[0].placeCategory,'공공기관');
  const item = {...page.items[0],kind:'place'};
  const report = api.buildSearchDiagnostics('검색어',[item]);
  assert.equal(report.candidates[0].searchType,'PLACE');
  assert.equal(report.candidates[0].id,item.id); assert.equal(report.candidates[0].originalIndex,0);
  assert.deepEqual(report.candidates[0].originalPoint,item.rawPoint);
  assert.equal(report.candidates[0].parsedCoordinate.longitude,126.978);
  assert.equal(report.candidates[0].roadAddress,undefined);
  assert.equal(api.buildSearchDiagnostics('',[candidate()]).candidates[0].originalPoint,undefined);
});

test('진단: 근접 거리·분리/병합 사유·대표 선정 점수·전후 건수 기록', () => {
  const a=candidate({title:undefined}), b=northMeters(candidate(),4), c=northMeters(candidate({id:'other'}),2);
  const report=api.buildSearchDiagnostics('서울시청',[a,b,c]);
  assert.deepEqual(report.counts,{before:3,after:2,displayed:2});
  const merged=report.pairs.find((pair)=>pair.leftOriginalIndex===0&&pair.rightOriginalIndex===1);
  assert.equal(merged.mergedInResult,true); assert.equal(merged.reason,'same-id-nearby');
  assert.ok(Math.abs(merged.distanceMeters-4)<1e-5);
  const separate=report.pairs.find((pair)=>pair.leftOriginalIndex===1&&pair.rightOriginalIndex===2);
  assert.equal(separate.mergedInResult,false); assert.equal(separate.objectReason,'different-ids');
  assert.equal(separate.reason,'unconfirmed-category-relationship');
  assert.equal(separate.possibleSameFacilityUnconfirmed,true);
  assert.equal(report.groups[0].representativeOriginalIndex,1);
  assert.equal(report.groups[0].scores[1].exactMatch,true);
  assert.deepEqual(report.groups[0].representativeRule,['exact-query-match','field-completeness','PLACE-ROAD-PARCEL','original-api-order']);
  const chain=api.buildSearchDiagnostics('',[candidate(),northMeters(candidate(),8),northMeters(candidate(),16)]);
  assert.equal(chain.pairs.find((pair)=>pair.leftOriginalIndex===1&&pair.rightOriginalIndex===2).groupConstraint,'complete-link-group-constraint');
});

test('진단: 인증값·URL·임의 응답 필드 제외, 출처 데이터 변경 없음', () => {
  const secret='offline/diagnostic-secret';
  const item=candidate({title:`장소 ${secret} https://example.invalid/?key=secret`, key:secret,callback:'secret-callback',ownerName:'PRIVATE_OWNER',requestUrl:'https://example.invalid'});
  const before=structuredClone(item);
  const serialized=JSON.stringify(api.buildSearchDiagnostics(`검색 ${encodeURIComponent(secret)}`,[item],secret));
  for (const forbidden of [secret,encodeURIComponent(secret),'https://','PRIVATE_OWNER','secret-callback','requestUrl']) assert.equal(serialized.includes(forbidden),false);
  assert.deepEqual(item,before);
});

test('개발 진단 UI: 추가 전송 없이 결과 복사·무효화·이벤트 정리', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'); let copied;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(value)=>{copied=value;}}}});
  const host=new Element(),ui=api.createSearchDiagnostics(host,'offline-key');
  try {
    const [summary,copy,output,status]=host.children[0].children;
    assert.match(summary.textContent,/개발 전용/); assert.equal(copy.disabled,true);
    ui.update({query:'서울시청',items:[candidate()],hasNext:false,failures:[]});
    assert.equal(copy.disabled,false); assert.equal(JSON.parse(output.value).counts.before,1);
    copy.fire('click'); await new Promise(setImmediate);
    assert.equal(copied,output.value); assert.equal(status.textContent,'진단 복사 완료');
    ui.clear(); assert.equal(output.value,''); assert.equal(copy.disabled,true);
  } finally {ui.dispose();if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});

test('프로덕션 검색 번들: 개발 진단 import·UI·로그가 포함되지 않음', async () => {
  const built=await build({stdin:{contents:`export { addressSearchFeature } from './src/features/addressSearch';`,resolveDir:root,loader:'ts'},
    define:{'import.meta.env.DEV':'false'},bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
  assert.equal(Object.keys(built.metafile.inputs).some((path)=>path.includes('searchDiagnostics')),false);
  const text=built.outputFiles[0].text;
  for(const marker of ['search-diagnostics-dev','imjinhong-search-diagnostics-v1','진단 복사','buildSearchDiagnostics']) assert.equal(text.includes(marker),false);
  const source=await readFile(new URL('../src/features/addressSearch.ts',import.meta.url),'utf8');
  assert.match(source,/if \(import\.meta\.env\.DEV\)\s*\{\s*void import\('\.\.\/dev\/searchDiagnostics'\)/);
});

// 사용자 Edge의 실제 관측 JSON. 나머지 가상 지명 사례와 구분하며 응답 객체 전체가 아닌 진단 형식이다.
const actualBytes = await readFile(new URL('./fixtures/jangsu-search-diagnostics-actual.json',import.meta.url));
const actualReport = JSON.parse(actualBytes.toString('utf8'));
const actualCandidates = actualReport.candidates.map((item) => ({kind:item.searchType.toLowerCase(),id:item.id,
  title:item.title,roadAddress:item.roadAddress,parcelAddress:item.parcelAddress,placeCategory:item.placeCategory,
  rawPoint:item.originalPoint,location:item.parsedCoordinate}));
const displayIdentity = (a,b) => api.assessSearchDisplayIdentity(api.normalizeSearchCandidate(a,0),api.normalizeSearchCandidate(b,1));

test('실측 fixture: 원본 7건·해시·좌표·순서·ID 보존, 객체 7개와 표시 그룹 4개 구분', () => {
  assert.equal(createHash('sha256').update(actualBytes).digest('hex'),'7a54dc7825f322ccbd219901ba902f785a783988364b02a311900abad5d26a1f');
  assert.equal(actualCandidates.length,7);
  actualReport.candidates.forEach((item,index) => {
    assert.equal(item.originalIndex,index); assert.equal(item.parsedCoordinate.crs,'EPSG:4326');
    assert.equal(Number(item.originalPoint.x),item.parsedCoordinate.longitude);
    assert.equal(Number(item.originalPoint.y),item.parsedCoordinate.latitude);
  });
  const before=structuredClone(actualCandidates), result=api.prepareSearchCandidates(actualCandidates,actualReport.query);
  assert.equal(result.objectCount,7); assert.equal(result.all.length,4); assert.equal(result.visible.length,1);
  assert.equal(result.filtering.applied,true); assert.equal(result.eligible[0],result.all[0]);
  assert.deepEqual(result.all.map((item)=>item.sources.map((source)=>actualCandidates.findIndex((original)=>original.id===source.id&&original.location.longitude===source.location.longitude))),[[0,1,2,5],[3],[6],[4]]);
  assert.deepEqual(actualCandidates,before);
  assert.deepEqual(result.all[0].location,actualCandidates[0].location);
  const report=api.buildSearchDiagnostics(actualReport.query,actualCandidates);
  assert.equal(report.displayGrouping.objectCount,7);
  assert.equal(report.pairs.find((pair)=>pair.leftOriginalIndex===0&&pair.rightOriginalIndex===1).objectMergeAllowed,false);
});

test('실측: 동일 명칭·도로명 0·1·2·5 표시 그룹, 다른 필지 3·소각시설 4·위치 충돌 ROAD 보존', () => {
  assert.equal(displayIdentity(actualCandidates[0],actualCandidates[1]).merge,true);
  assert.equal(displayIdentity(actualCandidates[0],actualCandidates[2]).merge,true);
  assert.equal(displayIdentity(actualCandidates[0],actualCandidates[3]).merge,false);
  assert.equal(displayIdentity(actualCandidates[0],actualCandidates[4]).merge,false);
  assert.equal(displayIdentity(actualCandidates[5],actualCandidates[6]).reason,'same-id-spatial-conflict');
  assert.equal(displayIdentity(actualCandidates[2],actualCandidates[5]).merge,true);
  assert.ok(Math.abs(api.searchCandidateDistanceMeters(actualCandidates[5],actualCandidates[6])-86.89430630068638)<1e-6);
  const ui=api.createSearchPanel(()=>{},()=>{}); let selected;
  ui.render({query:actualReport.query,items:actualCandidates,failures:[],hasNext:true},(item)=>{selected=item;});
  assert.equal(selected,undefined); ui.element.children[2].children[0].click();
  assert.deepEqual(selected.location,actualCandidates[0].location); assert.equal(selected.sources.length,4); ui.dispose();
});

test('가상 표시 그룹: 같은 명칭·주소와 양립 분류, 다른 기관·사업장·출입구·전국 동명 보존', () => {
  const a=candidate({id:'A',title:'가상 시설',placeCategory:'공공기관',roadAddress:'가상시 중앙로 1',parcelAddress:'가상시 가상동 1'});
  const b=northMeters({...a,id:'B',placeCategory:'공공기관 > 행정기관'},40);
  assert.equal(displayIdentity(a,b).merge,true);
  for(const change of [{title:'다른 기관'},{placeCategory:'사업장 > 행정기관'},{placeCategory:'공공기관 > 출입구'},
    {placeCategory:'음식점 > 식당'},{roadAddress:'다른시 중앙로 1'},{parcelAddress:'다른시 가상동 1'},{placeCategory:undefined}]) {
    assert.equal(displayIdentity(a,{...b,...change}).merge,false);
  }
  assert.equal(displayIdentity(a,northMeters({...b,location:a.location},5000)).merge,false);
  const station={...a,title:'가상역',placeCategory:'교통 > 철도역'};
  assert.equal(displayIdentity(station,{...b,title:'가상역 출입구',placeCategory:'교통 > 철도역 > 출입구'}).merge,false);
  assert.equal(displayIdentity(a,{...b,placeCategory:'공공기관'}).merge,true); // 같은 명칭·두 주소·근접성도 함께 만족한다.
  assert.equal(displayIdentity(a,{...b,placeCategory:'건물 > 업무시설'}).merge,true);
});

test('가상 표시 그룹: 50m 경계·상호 거리 검사·주소 생략의 토큰 경계 및 PLACE/ROAD/PARCEL', () => {
  const a=candidate({id:'A',title:'가상 시설',placeCategory:'기관',roadAddress:'가상시 중앙로 1',parcelAddress:'가상시 가상동 1'});
  const child={...a,id:'B',placeCategory:'기관 > 행정'};
  assert.equal(displayIdentity(a,northMeters(child,49.99)).merge,true);
  assert.equal(displayIdentity(a,northMeters(child,50)).merge,true);
  assert.equal(displayIdentity(a,northMeters(child,50.01)).merge,false);
  const road=northMeters({...a,kind:'road',id:'R',placeCategory:undefined,parcelAddress:'가상동 1'},9.99);
  assert.equal(displayIdentity(a,road).merge,true);
  assert.equal(displayIdentity(a,{...road,parcelAddress:'상동 1'}).merge,false);
  assert.equal(displayIdentity(a,{...road,parcelAddress:'1'}).merge,false);
  assert.equal(displayIdentity(a,{...road,roadAddress:'다른로 1'}).merge,false);
  assert.equal(displayIdentity(a,northMeters({...road,location:a.location},50.01)).merge,false);
  assert.equal(displayIdentity(road,northMeters({...road,kind:'parcel'},1)).merge,true);
  const prepared=api.prepareSearchCandidates([a,northMeters(child,40),northMeters({...road,location:a.location},-20)],'가상 시설');
  assert.equal(prepared.all.length,2); // 두 번째 POI와 주소 후보 간 60m: 연쇄 흡수 금지.
});

const stationBytes=await readFile(new URL('./fixtures/daejeon-search-diagnostics-actual.json',import.meta.url));
const stationReport=JSON.parse(stationBytes.toString('utf8'));
const stationCandidates=stationReport.candidates.map((item)=>({kind:item.searchType.toLowerCase(),id:item.id,title:item.title,
  roadAddress:item.roadAddress,parcelAddress:item.parcelAddress,placeCategory:item.placeCategory,
  rawPoint:item.originalPoint,location:item.parsedCoordinate}));

test('대전역 실측: 원본 해시·10건·필드·좌표 보존, 승강장·다른 필지와 주소 위치 충돌 분리', () => {
  assert.equal(createHash('sha256').update(stationBytes).digest('hex'),'cabaefd9281ceb60cb05709794bca51530cb79ec76787913965adeb3552a8565');
  assert.equal(stationCandidates.length,10);
  stationReport.candidates.forEach((item,index)=>{
    assert.equal(item.originalIndex,index); assert.ok(item.id); assert.ok(item.title);
    assert.equal(item.parsedCoordinate.crs,'EPSG:4326');
    assert.equal(Number(item.originalPoint.x),item.parsedCoordinate.longitude);
    assert.equal(Number(item.originalPoint.y),item.parsedCoordinate.latitude);
  });
  const before=structuredClone(stationCandidates), result=api.prepareSearchCandidates(stationCandidates,stationReport.query);
  assert.equal(result.objectCount,10); assert.equal(result.all.length,10); assert.equal(result.visible.length,5);
  assert.deepEqual(result.all.map((item)=>item.sources),stationCandidates.map((item)=>[item]));
  assert.deepEqual(stationCandidates,before);
  assert.ok(api.searchCandidateDistanceMeters(stationCandidates[0],stationCandidates[5])>12000);
  assert.ok(api.searchCandidateDistanceMeters(stationCandidates[5],stationCandidates[9])>880);
  assert.equal(displayIdentity(stationCandidates[0],stationCandidates[2]).merge,false);
  assert.equal(displayIdentity(stationCandidates[4],stationCandidates[5]).merge,false);
  assert.equal(result.all[5].positionUncertain,true);
  assert.deepEqual(result.all[5].conflictingSourceIndices,[6,7,8,9]);
  for(let i=0;i<10;i++) assert.deepEqual(result.all[i].location,stationCandidates[i].location);
  const diagnostic=api.buildSearchDiagnostics(stationReport.query,stationCandidates);
  assert.equal(diagnostic.displayGrouping.positionConflicts.length,5);
  const ui=api.createSearchPanel(()=>{},()=>{}); let selected;
  ui.render({query:stationReport.query,items:stationCandidates,failures:[],hasNext:true},(item)=>{selected=item;});
  assert.match(ui.element.children[1].textContent,/서로 다른 위치/);
  ui.element.children[2].children[0].click(); assert.deepEqual(selected.location,stationCandidates[0].location);
  ui.dispose();
});

test('가상 주소 정규화: 법정동 괄호·행정구역 생략만 보완, 다른 지역·번호·도로·건물 괄호 보존', () => {
  const a=candidate({id:'N1',title:'가상 기관',roadAddress:'가상광역시 동구 중앙로 215 (정동)',parcelAddress:'가상광역시 동구 정동 1-1',placeCategory:'공공기관'});
  const b=northMeters({...a,id:'N2',roadAddress:'동구 중앙로 215',parcelAddress:'정동 1-1'},20);
  assert.equal(displayIdentity(a,b).merge,true);
  assert.equal(api.normalizeSearchRoadAddress(a.roadAddress,a.parcelAddress),'가상광역시 동구 중앙로 215');
  assert.equal(api.normalizeSearchRoadAddress('중앙로 215 (101동)',a.parcelAddress),'중앙로 215 (101동)');
  assert.equal(api.normalizeSearchRoadAddress('중앙로 215 (부속동)',a.parcelAddress),'중앙로 215 (부속동)');
  assert.equal(api.normalizeSearchRoadAddress('중앙로 215 (별관)'),'중앙로 215 (별관)');
  for(const roadAddress of ['다른광역시 동구 중앙로 215','동구 중앙로 216','동구 중앙길 215','중앙로 215 (다른건물)']) {
    assert.equal(displayIdentity(a,{...b,roadAddress}).merge,false);
  }
  assert.equal(displayIdentity(a,{...b,parcelAddress:'다른광역시 정동 1-1'}).merge,false);
  assert.equal(displayIdentity(a,{...b,title:'같은 건물의 다른 기관'}).merge,false);
  assert.equal(displayIdentity(a,{...b,placeCategory:'음식점 > 식당'}).merge,false);
});

test('가상 지번 전용: 분류와 지번 일치·근접성 모두 필요, 승강장과 별도 사업장 보존', () => {
  const a=candidate({id:'P1',title:'가상 시설',roadAddress:undefined,parcelAddress:'가상시 가상동 1',placeCategory:'공공기관'});
  const b=northMeters({...a,id:'P2',placeCategory:'공공기관 > 행정'},20);
  assert.equal(displayIdentity(a,b).merge,true);
  for(const change of [{parcelAddress:'가상시 가상동 2'},{placeCategory:undefined},{placeCategory:'철도시설 > 승강장'},{placeCategory:'음식점'}]) {
    assert.equal(displayIdentity(a,{...b,...change}).merge,false);
  }
  assert.equal(displayIdentity(a,northMeters({...b,location:a.location},51)).merge,false);
});

test('가상 학교·병원·역: 같은 주소 ID의 큰 위치 차이는 개별 위치 보존과 경고, 선택 좌표 원본 유지', () => {
  for(const title of ['가상 학교','가상 병원','가상 역']) {
    const a=candidate({kind:'road',id:'address-object',title,roadAddress:'가상시 중앙로 1',parcelAddress:'가상시 가상동 1'});
    const b=northMeters(a,500), result=api.prepareSearchCandidates([a,b],title);
    assert.equal(result.all.length,2); assert.equal(result.all[0].positionUncertain,true);
    const ui=api.createSearchPanel(()=>{},()=>{}); let selected;
    ui.render({query:title,items:[a,b],failures:[],hasNext:false},(item)=>{selected=item;});
    assert.match(ui.element.children[2].children[1].children[1].textContent,/위치 차이/);
    ui.element.children[2].children[1].click(); assert.deepEqual(selected.location,b.location); ui.dispose();
  }
});

// 아래 순위 사례는 전주시청의 실제 응답이 아닌 합성 데이터다. 실제 본청의 정답을 뜻하지 않는다.
const qualityCandidate=(overrides={})=>candidate({id:'quality',title:'가상병원',roadAddress:'가상광역시 가상구 중앙로 10',
  parcelAddress:'가상광역시 가상구 가상동 1',placeCategory:'의료시설 > 병원',...overrides});
test('합성 순위: 같은 시설명·다른 주소에서 분류 관련성과 완전한 주소 우선, 원본 순서만으로 결정하지 않음',()=>{
  const sparse=qualityCandidate({id:'sparse',roadAddress:'다른길',parcelAddress:undefined,placeCategory:'통신판매업'});
  const full=northMeters(qualityCandidate({id:'full'}),500);
  const result=api.prepareSearchCandidates([sparse,full],'가상병원');
  assert.equal(result.all[0].id,'full'); assert.equal(result.all.length,2);
  assert.equal(result.all[0].ranking.categoryIntent,1); assert.equal(result.all[0].ranking.addressCompleteness,2);
  assert.deepEqual(result.all[0].location,full.location);
});
test('합성 순위: 복수 유형의 주소·명칭·근접 좌표 일치는 보조 근거, 반복 레코드 수는 가점 없음',()=>{
  const single=qualityCandidate({id:'single',roadAddress:'가상광역시 가상구 다른로 20',parcelAddress:'가상광역시 가상구 다른동 2'});
  const place=qualityCandidate({id:'place'}), road=northMeters({...place,kind:'road',id:'road',placeCategory:undefined},5);
  const result=api.prepareSearchCandidates([single,place,road],'가상병원');
  assert.equal(result.all[0].id,'place'); assert.equal(result.all[0].ranking.crossTypeAgreement,1);
  const repeated=api.prepareSearchCandidates([single,{...single},place,road],'가상병원');
  assert.equal(repeated.all[0].id,'place'); assert.deepEqual(repeated.all[1].ranking,result.all[1].ranking);
  const conflicting=northMeters(road,500);
  const withConflict=api.prepareSearchCandidates([single,place,road,conflicting],'가상병원');
  assert.equal(withConflict.all[0].id,'place');
  assert.equal(withConflict.all.find((item)=>item.id==='place').ranking.crossTypeAgreement,1);
  assert.equal(withConflict.all.find((item)=>item.id==='place').positionUncertain,true);
  assert.equal('stablePosition' in withConflict.all[0].ranking,false);
});
test('합성 순위: 정확 일치 보존, 오분류·불완전 주소·부속 명칭에 과도한 가점 없음',()=>{
  const exact=qualityCandidate({id:'exact',roadAddress:undefined,parcelAddress:undefined,placeCategory:undefined});
  const annex=qualityCandidate({id:'annex',title:'가상병원 부속시설'});
  const result=api.prepareSearchCandidates([annex,exact],'가상병원');
  assert.equal(result.all[0].id,'exact'); assert.equal(result.all[0].ranking.addressCompleteness,0);
  assert.equal(result.all[1].ranking.categoryIntent,0);
  const unknown=qualityCandidate({id:'unknown',placeCategory:undefined});
  assert.equal(api.prepareSearchCandidates([unknown],'가상병원').all[0].id,'unknown');
  const full=qualityCandidate({id:'full',roadAddress:'가상광역시 가상구 다른로 20',parcelAddress:'가상광역시 가상구 다른동 2'});
  const sparse=qualityCandidate({id:'sparse',roadAddress:'가상구',parcelAddress:'1'});
  assert.equal(api.prepareSearchCandidates([sparse,full],'가상병원').all[0].id,'full');
  const diagnostic=api.buildSearchDiagnostics('가상병원',[sparse,full]);
  assert.equal(diagnostic.rankedGroups[0].representativeOriginalIndex,1);
});
test('합성 순위: 단일 ROAD·PARCEL 결과도 보존, 주소 정확 일치가 장소 분류 가점보다 우선',()=>{
  const road=qualityCandidate({id:'address',kind:'road',title:undefined,placeCategory:undefined});
  const place=qualityCandidate({id:'poi',roadAddress:'가상광역시 가상구 다른로 20',parcelAddress:'가상광역시 가상구 다른동 2'});
  assert.equal(api.prepareSearchCandidates([place,road],road.roadAddress).all[0].id,'address');
  for(const kind of ['road','parcel']) {
    const result=api.prepareSearchCandidates([{...road,kind}],road.roadAddress);
    assert.equal(result.visible.length,1); assert.deepEqual(result.visible[0].location,road.location);
  }
});

const officeBytes=await readFile(new URL('./fixtures/jeonju-search-diagnostics-actual.json',import.meta.url));
const officeReport=JSON.parse(officeBytes.toString('utf8'));
const officeCandidates=officeReport.candidates.map((item)=>({kind:item.searchType.toLowerCase(),id:item.id,title:item.title,
  roadAddress:item.roadAddress,parcelAddress:item.parcelAddress,placeCategory:item.placeCategory,
  rawPoint:item.originalPoint,location:item.parsedCoordinate}));

test('전주시청 실측: 원본 8건·해시 보존, 지방행정기관 0·5가 통신판매업·기념품점·충전소보다 우선',()=>{
  assert.equal(createHash('sha256').update(officeBytes).digest('hex'),'3ed1913fedc6d785d85d4dc59c6c221f2aec0f3b3efa799373ef19b42da293f6');
  assert.equal(officeCandidates.length,8);
  officeReport.candidates.forEach((item,index)=>{
    assert.equal(item.originalIndex,index); assert.ok(item.id); assert.equal(item.parsedCoordinate.crs,'EPSG:4326');
    assert.equal(Number(item.originalPoint.x),item.parsedCoordinate.longitude);
    assert.equal(Number(item.originalPoint.y),item.parsedCoordinate.latitude);
  });
  const before=structuredClone(officeCandidates), result=api.prepareSearchCandidates(officeCandidates,officeReport.query);
  const indices=(item)=>item.sources.map((source)=>officeCandidates.findIndex((original)=>original.kind===source.kind
    && original.id===source.id && original.location.longitude===source.location.longitude && original.location.latitude===source.location.latitude));
  assert.equal(result.objectCount,8); assert.equal(result.all.length,7); assert.equal(result.visible.length,2);
  assert.deepEqual(result.all.map(indices),[[0,5],[1],[2],[4],[3],[6],[7]]);
  assert.equal(result.all[0].ranking.categoryIntent,1);
  assert.equal(result.all[0].ranking.crossTypeAgreement,1); // 24.56m·법정동 괄호·행정구역 생략을 기존 표시 규칙대로 평가한다.
  assert.equal(result.all[0].positionUncertain,true);
  assert.deepEqual(result.all[0].location,officeCandidates[0].location);
  for(const index of [5,6,7]) {
    const preserved=result.all.flatMap((item)=>item.sources).find((source)=>source.kind==='road'
      && source.id===officeCandidates[index].id && source.location.longitude===officeCandidates[index].location.longitude);
    assert.deepEqual(preserved,officeCandidates[index]);
  }
  assert.deepEqual(officeCandidates,before);
  const ui=api.createSearchPanel(()=>{},()=>{}); let selected;
  ui.render({query:officeReport.query,items:officeCandidates,failures:[],hasNext:true},(item)=>{selected=item;});
  assert.match(ui.element.children[2].children[0].children[1].textContent,/위치 차이/);
  ui.element.children[2].children[0].click(); assert.deepEqual(selected.location,officeCandidates[0].location); ui.dispose();
});

test('합성 시설 유형: 행정기관 상위 분류·명시 유형 일치만 인정하고 접미부·하위 유형 오인식 방지',()=>{
  for(const suffix of ['시청','군청','구청']) {
    assert.equal(api.searchCategoryMatchesIntent(`가상${suffix}`,'지방행정기관'),true);
    assert.equal(api.searchCategoryMatchesIntent(`가상${suffix}`,`지방행정기관 > ${suffix}`),true);
    assert.equal(api.searchCategoryMatchesIntent(`가상${suffix}`,'통신판매업 > 종합몰통신판매업'),false);
    assert.equal(api.searchCategoryMatchesIntent(`가상${suffix}`,undefined),false);
  }
  for(const query of ['가상시청역','가상군청앞약국','가상구청사','시청각센터']) {
    assert.equal(api.searchCategoryMatchesIntent(query,'지방행정기관'),false);
  }
  assert.equal(api.searchCategoryMatchesIntent('가상시청','지방행정기관 > 군청'),false);
  assert.equal(api.searchCategoryMatchesIntent('가상병원','의료시설 > 병원 > 종합병원'),true);
  assert.equal(api.searchCategoryMatchesIntent('가상도서관','문화시설 > 도서관'),true);
  assert.equal(api.searchCategoryMatchesIntent('가상도서관','서점'),false);
});

test('합성 순위: 위치 충돌은 경고만 유지하며 동일 근거의 후보 순위를 바꾸지 않음',()=>{
  const a=qualityCandidate({id:'a'}), distant=northMeters({...a,id:'b'},100);
  const group=[api.normalizeSearchCandidate(a,0)];
  const score=api.scoreSearchGroup(group,a.title);
  assert.equal('stablePosition' in score,false);
  assert.deepEqual(api.prepareSearchCandidates([a,distant],a.title).all.map((item)=>item.ranking),[score,score]);
  const result=api.prepareSearchCandidates([a,distant],a.title);
  assert.deepEqual(result.all.map((item)=>item.id),['a','b']);
  assert.ok(result.all.every((item)=>item.positionUncertain));
  const unknownA={...a,id:'unknown-a',placeCategory:undefined};
  const unknownB={...distant,id:'unknown-b',placeCategory:undefined};
  assert.deepEqual(api.prepareSearchCandidates([unknownB,unknownA],a.title).all.map((item)=>item.id),['unknown-b','unknown-a']);
});

test('전주시청 표시 필터: 0·5와 개별 근거가 있는 ROAD 7 유지, 다른 분류와 근거 부족 ROAD 6은 화면만 제외',()=>{
  const before=structuredClone(officeCandidates), result=api.prepareSearchCandidates(officeCandidates,officeReport.query);
  const indices=(item)=>item.sources.map((source)=>officeCandidates.findIndex((original)=>original.kind===source.kind
    && original.id===source.id && original.location.longitude===source.location.longitude));
  assert.deepEqual(result.eligible.map(indices),[[0,5],[7]]);
  assert.equal(result.all.length,7); assert.equal(result.all.flatMap((item)=>item.sources).length,8);
  assert.deepEqual(officeCandidates,before);
  for(const index of [1,2,3,4,6]) assert.ok(!result.visible.some((item)=>indices(item).includes(index)));
  assert.equal(result.filtering.decisions.find((decision)=>decision.groupIndex===5).reason,'address-relevance-unconfirmed');
  assert.ok(result.visible.every((item)=>item.positionUncertain));
  const ui=api.createSearchPanel(()=>{},()=>{}); let selected;
  ui.render({query:officeReport.query,items:officeCandidates,failures:[],hasNext:true},(item)=>{selected=item;});
  assert.equal(ui.element.children[2].children.length,2); assert.equal(ui.getCandidates().length,7);
  assert.match(ui.element.children[1].textContent,/5개 후보를 화면에서 제외/);
  ui.element.children[2].children[1].click(); assert.deepEqual(selected.location,officeCandidates[7].location); ui.dispose();
  const diagnostic=api.buildSearchDiagnostics(officeReport.query,officeCandidates);
  assert.deepEqual(diagnostic.counts,{before:8,after:7,displayed:2});
  assert.equal(diagnostic.displayFilter.eligibleGroups,2);
  assert.equal(diagnostic.candidates.length,8);
});

test('실측 표시 필터: 장수군청 원본·4그룹 유지 및 본청만 표시, 대전역은 판별 보류로 기존 결과 유지',()=>{
  const office=api.prepareSearchCandidates(actualCandidates,actualReport.query);
  assert.equal(office.rawCount,7); assert.equal(office.objectCount,7); assert.equal(office.all.length,4);
  assert.equal(office.visible.length,1); assert.equal(office.visible[0].sources.length,4);
  const station=api.prepareSearchCandidates(stationCandidates,stationReport.query);
  assert.equal(station.rawCount,10); assert.equal(station.all.length,10); assert.equal(station.visible.length,5);
  assert.equal(station.filtering.applied,false);
  assert.ok(station.all.slice(5).every((item)=>item.positionUncertain));
});

test('합성 표시 필터: 접미부 오인식·미지원 유형·일반 명칭·관련 후보 없음·주소 전용 검색은 원래 결과 보존',()=>{
  const unrelated=qualityCandidate({id:'other',title:'가상군청',placeCategory:'통신판매업'});
  assert.equal(api.prepareSearchCandidates([unrelated],'가상군청').filtering.applied,false);
  for(const query of ['가상시청역','가상군청앞약국','가상경찰서','가상소방서','가상우체국','가상대학교','가상철도역','일반 장소']) {
    assert.equal(api.inferSearchFilterIntent(query),undefined);
    const result=api.prepareSearchCandidates([{...unrelated,title:query}],query);
    assert.equal(result.visible.length,1); assert.equal(result.filtering.applied,false);
  }
  for(const kind of ['road','parcel']) {
    const list=Array.from({length:6},(_,index)=>northMeters({...unrelated,kind,id:`address-${index}`,placeCategory:undefined},index*100));
    const result=api.prepareSearchCandidates(list,'가상군청');
    assert.equal(result.all.length,6); assert.equal(result.visible.length,5); assert.equal(result.filtering.applied,false);
  }
});

test('합성 표시 필터: 분류 누락·미확인 PLACE는 보존, 관련 주소의 개별 위치 유지 및 상위 5개 제한',()=>{
  const anchor=qualityCandidate({id:'anchor',title:'가상구청',placeCategory:'지방행정기관'});
  const unknown=northMeters({...anchor,id:'unknown',roadAddress:'가상시 다른로 3',placeCategory:undefined},200);
  const broad=northMeters({...unknown,id:'broad',placeCategory:'공공기관'},200);
  const other=northMeters({...unknown,id:'commercial',placeCategory:'통신판매업'},400);
  const road=northMeters({...anchor,id:'address',kind:'road',placeCategory:undefined},20);
  const parcel=northMeters({...anchor,id:'parcel',kind:'parcel',placeCategory:undefined},-20);
  const list=[other,unknown,broad,anchor,road,parcel]; const before=structuredClone(list);
  const result=api.prepareSearchCandidates(list,'가상구청');
  assert.equal(result.filtering.applied,true);
  assert.ok(result.eligible.some((item)=>item.id==='unknown'));
  assert.ok(result.eligible.some((item)=>item.id==='broad'));
  assert.ok(!result.eligible.some((item)=>item.id==='commercial'));
  assert.ok(result.eligible.flatMap((item)=>item.sources).some((item)=>item.kind==='parcel'));
  assert.deepEqual(list,before);
  const many=Array.from({length:7},(_,index)=>northMeters({...anchor,id:`a-${index}`,roadAddress:`가상시 중앙로 ${index+1}`,parcelAddress:undefined},index*100));
  const capped=api.prepareSearchCandidates([other,...many],'가상구청');
  assert.equal(capped.eligible.length,7); assert.equal(capped.visible.length,5); assert.equal(capped.all.length,8);
});
