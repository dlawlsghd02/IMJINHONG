import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// 기존 esbuild만 사용해 테스트용 모듈을 메모리에 번들링한다. 파일 출력·서버·키 로딩은 없다.
const root = fileURLToPath(new URL('../', import.meta.url));
globalThis.fetch = () => { throw new Error('테스트 외부 통신 금지'); };
async function bundle(contents, plugins = [], define = {}) {
  const result = await build({ stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, plugins,
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': 'undefined', ...define } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const api = await bundle(`
  export { parseCadastral, validateParcelBox, createCadastralProvider } from './src/services/vworld/cadastral';
  export { createParcelBoundaryCache } from './src/features/parcelBoundaryCache';
  export { parcelConfig } from './src/config/parcel';
  export { ParcelError } from './src/services/vworld/parcelValidation';
  export { createParcelPanel } from './src/ui/parcelPanel';
  export { priceStatistics } from './src/features/landPriceHistory';
  export { default as Feature } from 'ol/Feature.js';
  export { default as Polygon } from 'ol/geom/Polygon.js';
  export { transform, transformExtent } from 'ol/proj.js';
`);
const id = '1114010300100310000'; // 테스트 전용 공개 형식 식별자. 실제 조회하지 않는다.
const ring = [[126.977, 37.566], [126.978, 37.566], [126.978, 37.567], [126.977, 37.567], [126.977, 37.566]];
function response(overrides = {}) {
  return { response: { status: 'OK', record: { current: '1', total: '1' }, page: { current: '1', size: '1000', total: '1' },
    result: { featureCollection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { pnu: id, jibun: '모의 지번' },
      geometry: { type: 'Polygon', coordinates: [ring] } }] } }, ...overrides } };
}
function batch(features = []) { return { features, truncated: false, completeness: 'complete' }; }
function feature(index = 0, positions = ring) {
  const value = new api.Feature({ geometry: new api.Polygon([positions]), pnu: String(index).padStart(19, '0') });
  value.setId(String(index)); return value;
}
function withClock(run) {
  const original = Date.now;
  let time = 1_000;
  Date.now = () => time;
  try { run((value) => { time = value; }); } finally { Date.now = original; }
}

test('설정: POINT 15 / BOX 15, 자동 BOX false', () => {
  assert.equal(api.parcelConfig.pointMinZoom, 15); assert.equal(api.parcelConfig.boxMinZoom, 15);
  assert.equal(api.parcelConfig.autoBoundaryQueryEnabled, false);
  assert.equal(api.parcelConfig.maxAreaSquareMeters, 5_000_000);
  assert.equal(api.parcelConfig.maxFeatures, 1000);
  assert.equal(api.parcelConfig.cacheMaxFeatures, 1000);
  assert.equal(api.parcelConfig.maxBoxCoordinates, 200000);
  assert.equal(api.parcelConfig.cacheMaxCoordinates, 100000);
});
test('작은 BOX 허용 / 넓은 BOX 차단', () => {
  assert.doesNotThrow(() => api.validateParcelBox([126.977, 37.566, 126.978, 37.567]));
  assert.throws(() => api.validateParcelBox([126.97, 37.56, 127.01, 37.60]), /5㎢/);
});
test('5㎢ 구면 면적 경계값 전후', () => {
  const south = 37.56, north = 37.565, radians = Math.PI / 180;
  const width = 5_000_000 / (6_371_008.8 ** 2 * radians * (Math.sin(north * radians) - Math.sin(south * radians)));
  assert.doesNotThrow(() => api.validateParcelBox([126.97, south, 126.97 + width * 0.999, north]));
  assert.throws(() => api.validateParcelBox([126.97, south, 126.97 + width * 1.001, north]));
});
test('회전 화면 외접 BOX가 면적 상한을 넘으면 차단', () => {
  const center = api.transform([126.978, 37.566], 'EPSG:4326', 'EPSG:3857');
  // 서울 부근 지상 1,800m 정사각형: 회전 전 약 3.24㎢, 45도 회전 외접 BOX 약 6.48㎢.
  const side = 1800 / Math.cos(37.566 * Math.PI / 180);
  const box = (width) => api.transformExtent([center[0] - width / 2, center[1] - width / 2, center[0] + width / 2, center[1] + width / 2], 'EPSG:3857', 'EPSG:4326');
  assert.doesNotThrow(() => api.validateParcelBox(box(side)));
  assert.throws(() => api.validateParcelBox(box(side * Math.SQRT2)), /5㎢/);
});
test('잘못된 BOX: 역전·날짜변경선·무한값 거부', () => {
  for (const box of [[127, 38, 126, 37], [179, 37, -179, 38], [126, 37, Infinity, 38]]) assert.throws(() => api.validateParcelBox(box));
});
test('BOX 메타데이터 완전 / PNU 문자열 / 도형 변환', () => {
  const result = api.parseCadastral(response(), 1000, 'box');
  assert.equal(result.completeness, 'complete'); assert.equal(result.features[0].get('pnu'), id);
  assert.equal(result.features[0].getGeometry().getType(), 'Polygon');
  assert.ok(result.features[0].getGeometry().intersectsCoordinate(api.transform([126.9775, 37.5665], 'EPSG:4326', 'EPSG:3857')));
});
test('BOX 일부 반환 감지', () => {
  const result = api.parseCadastral(response({ record: { current: 1, total: 1001 }, page: { current: 1, size: 1000, total: 2 } }), 1000, 'box');
  assert.equal(result.completeness, 'partial'); assert.equal(result.truncated, true);
});

test('1,000건 요청에 서버 page.size=500 축소 응답은 거부', () => {
  const value = response({ page: { current: 1, size: 500, total: 1 } });
  assert.throws(() => api.parseCadastral(value, 1000, 'box'), /모순/);
});

test('BOX 합산 200,000좌표 초과는 1,000피처 이내여도 거부', () => {
  const value = response({ record: { current: 3, total: 3 } });
  const template = value.response.result.featureCollection.features[0];
  value.response.result.featureCollection.features = Array.from({ length: 3 }, (_, i) => ({
    ...template, properties: { pnu: String(i).padStart(19, '0') },
    geometry: { type: 'Polygon', coordinates: [Array.from({ length: 70000 }, () => [126.977, 37.566])] },
  }));
  assert.throws(() => api.parseCadastral(value, 1000, 'box'), /좌표 수.*상한/);
});

test('캐시 1,000피처 허용·1,001피처 거부, 원본 보호', () => {
  const cache = api.createParcelBoundaryCache(), rows = Array.from({ length: 1000 }, (_, i) => feature(i));
  cache.put('valid', batch(rows)); assert.equal(cache.get('valid').features.length, 1000);
  cache.put('oversized', batch([...rows, feature(1000)])); assert.equal(cache.get('oversized'), undefined);
  assert.equal(cache.get('valid').features.length, 1000);
});

test('UI 배치: 공통 세로 컨테이너에 지적도 다음 용도지역, 독립 절대위치 제거', async () => {
  const layout = await readFile(new URL('../src/ui/layout.ts', import.meta.url), 'utf8');
  const parcelCss = await readFile(new URL('../src/styles/parcel.css', import.meta.url), 'utf8');
  const zoningCss = await readFile(new URL('../src/styles/zoning.css', import.meta.url), 'utf8');
  assert.match(layout, /class="layer-controls-stack">\s*<div id="parcel-controls-host"><\/div>\s*<div id="zoning-controls-host"><\/div>/);
  assert.match(parcelCss, /\.layer-controls-stack\s*\{[^}]*display: flex;[^}]*flex-direction: column/);
  assert.doesNotMatch(zoningCss, /#zoning-controls-host\s*\{[^}]*position: absolute/);
});

test('UI 안내: 빈 상태는 숨김, 오류·자료 없음은 표시', () => {
  const ui = api.createParcelPanel(() => {}, () => {}), status = ui.controls.children[1];
  ui.setStatus(''); assert.equal(status.hidden, true);
  for (const value of ['조회 오류', '조회 가능한 필지가 없습니다.']) {
    ui.setStatus(value); assert.equal(status.hidden, false); assert.equal(status.textContent, value);
  }
  ui.setBoundaryStatus('일부 경계만 조회되었습니다.'); assert.equal(ui.controls.children[2].hidden, false);
  ui.setBoundaryStatus(''); assert.equal(ui.controls.children[2].hidden, true); ui.dispose();
});
test('BOX 누락·잘못된 메타데이터는 완전성 미확인', () => {
  for (const overrides of [{ record: undefined, page: undefined }, { record: { current: 'x', total: '1' } }])
    assert.equal(api.parseCadastral(response(overrides), 1000, 'box').completeness, 'unknown');
});
test('BOX 모순된 메타데이터 거부', () => {
  assert.throws(() => api.parseCadastral(response({ record: { current: 2, total: 1 } }), 1000, 'box'), /모순/);
});
test('BOX NOT_FOUND를 완전한 데이터로 확정하지 않음', () => {
  assert.equal(api.parseCadastral({ response: { status: 'NOT_FOUND' } }, 1000, 'box').completeness, 'unknown');
});
test('POINT 기존 엄격한 메타데이터 검사 유지', () => {
  assert.equal(api.parseCadastral(response({ page: { current: 1, size: 5, total: 1 } }), 5).features.length, 1);
  assert.throws(() => api.parseCadastral(response({ record: undefined }), 5));
});
test('잘못된 CRS·숫자 PNU·중복 PNU 거부', () => {
  const crs = response(); crs.response.result.crs = 'EPSG:3857'; assert.throws(() => api.parseCadastral(crs, 1000, 'box'));
  const number = response(); number.response.result.featureCollection.features[0].properties.pnu = Number(id);
  assert.throws(() => api.parseCadastral(number, 1000, 'box'));
  const duplicate = response(); duplicate.response.result.featureCollection.features.push(duplicate.response.result.featureCollection.features[0]);
  duplicate.response.record = { current: 2, total: 2 }; assert.throws(() => api.parseCadastral(duplicate, 1000, 'box'), /중복/);
});
test('1,000건 반환도 메타데이터 없으면 완전성 미확인', () => {
  const value = response({ record: undefined, page: undefined });
  const template = value.response.result.featureCollection.features[0];
  value.response.result.featureCollection.features = Array.from({ length: 1000 }, (_, i) => ({ ...template, properties: { pnu: String(i).padStart(19, '0') } }));
  assert.equal(api.parseCadastral(value, 1000, 'box').completeness, 'unknown');
});
for (const [total, completeness, truncated] of [[1000, 'complete', false], [1001, 'partial', true]]) {
  test(`1,000건 반환: 전체 ${total}건의 페이지 메타데이터로 ${completeness} 판정`, () => {
    const value = response({ record: { current: 1000, total }, page: { current: 1, size: 1000, total: Math.ceil(total / 1000) } });
    const template = value.response.result.featureCollection.features[0];
    value.response.result.featureCollection.features = Array.from({ length: 1000 }, (_, i) => ({ ...template, properties: { pnu: String(i).padStart(19, '0') } }));
    const result = api.parseCadastral(value, 1000, 'box');
    assert.equal(result.features.length, 1000);
    assert.equal(result.completeness, completeness);
    assert.equal(result.truncated, truncated);
  });
}

test('BOX 응답 1,000건 상한 초과 거부', () => {
  const value = response(); const rows = value.response.result.featureCollection.features;
  value.response.result.featureCollection.features = Array(1001).fill(rows[0]);
  assert.throws(() => api.parseCadastral(value, 1000, 'box'), /상한/);
});
test('캐시 TTL 60초, 접근으로 만료 시점 연장하지 않음', () => withClock((setTime) => {
  const cache = api.createParcelBoundaryCache(); cache.put('a', batch([feature()]));
  setTime(60_999); assert.ok(cache.get('a')); setTime(61_000); assert.equal(cache.get('a'), undefined);
}));
test('캐시 최대 8개와 LRU 갱신', () => {
  const cache = api.createParcelBoundaryCache();
  for (let i = 0; i < 8; i++) cache.put(String(i), batch([feature(i)]));
  cache.get('0'); cache.put('8', batch([feature(8)]));
  assert.equal(cache.get('1'), undefined); assert.ok(cache.get('0')); assert.ok(cache.get('8'));
});
test('캐시 합산 피처 1,000개 제한', () => {
  const cache = api.createParcelBoundaryCache();
  const rows = Array.from({ length: 200 }, (_, i) => feature(i));
  for (let i = 0; i < 6; i++) cache.put(String(i), batch(rows));
  assert.equal(cache.get('0'), undefined); assert.ok(cache.get('5'));
});
test('캐시 합산 좌표 100,000개 및 개별 과대 항목 차단', () => {
  const cache = api.createParcelBoundaryCache();
  const large = feature(1, Array.from({ length: 60_000 }, () => [126, 37]));
  cache.put('a', batch([large])); cache.put('b', batch([large]));
  assert.equal(cache.get('a'), undefined); assert.ok(cache.get('b'));
  cache.put('oversized', batch([feature(2, Array.from({ length: 100_001 }, () => [126, 37]))]));
  assert.equal(cache.get('oversized'), undefined);
});
test('캐시 부분·불명확·잘린 데이터 제외', () => {
  const cache = api.createParcelBoundaryCache();
  for (const state of [{ completeness: 'partial', truncated: true }, { completeness: 'unknown', truncated: false }, { completeness: 'complete', truncated: true }]) {
    cache.put('a', { ...batch([feature()]), ...state }); assert.equal(cache.get('a'), undefined);
  }
});
test('캐시 복제·ID 보존 및 clear', () => {
  const cache = api.createParcelBoundaryCache(), original = feature(7); cache.put('a', batch([original]));
  original.set('pnu', 'changed'); const copy = cache.get('a');
  assert.equal(copy.features[0].getId(), '7'); assert.notEqual(copy.features[0].get('pnu'), 'changed');
  copy.features[0].getGeometry().translate(10, 10);
  assert.notDeepEqual(copy.features[0].getGeometry().getCoordinates(), cache.get('a').features[0].getGeometry().getCoordinates());
  cache.clear(); assert.equal(cache.get('a'), undefined);
});
test('실제 서비스의 BOX 가드는 통신 전에 차단', () => {
  assert.throws(() => api.createCadastralProvider('').box([126.977, 37.566, 126.978, 37.567], new AbortController().signal), /비활성/);
});

// 실제 자동 BOX 설정은 false로 유지하고 지도·DOM·POINT 응답만 모의 처리한다.
class ElementMock {
  children = []; listeners = new Map(); attributes = new Map(); hidden = false; textContent = '';
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  remove() {}
  click() { this.listeners.get('click')?.(); }
}
globalThis.document = { createElement: () => new ElementMock() };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
globalThis.parcelOfflineMocks = { calls: [], point: undefined };
const mounted = await bundle(`export { cadastralFeature } from './src/features/cadastral';`, [{
  name: 'offline-provider', setup(builder) {
    builder.onLoad({ filter: /[/\\]services[/\\]vworld[/\\]cadastral\.ts$/ }, () => ({ loader: 'ts', contents: `
      export const cadastralSource = 'https://www.vworld.kr/';
      export function validateParcelBox() { throw new Error('자동 BOX가 호출되면 테스트 실패'); }
      export function createCadastralProvider() { return {
        point(coordinate, signal) { globalThis.parcelOfflineMocks.calls.push({coordinate, signal}); return globalThis.parcelOfflineMocks.point.promise; },
        box() { throw new Error('외부 BOX 호출 금지'); }
      }; }
    ` }));
  },
}]);
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setupMap() {
  const handlers = new Map(), layers = [];
  let zoom = 18;
  const map = {
    getView: () => ({ getZoom: () => zoom }),
    on(type, listener) { handlers.set(type, listener); return { target: { removeEventListener() {} }, type, listener }; },
    addLayer(layer) { layers.push(layer); }, removeLayer() {}, hasFeatureAtPixel: () => false,
  };
  const controls = new ElementMock(), details = new ElementMock();
  globalThis.parcelOfflineMocks.calls = []; globalThis.parcelOfflineMocks.point = deferred();
  const dispose = mounted.cadastralFeature.mount({ map, parcelControlsHost: controls, parcelPanelHost: details, vworldApiKey: '', searchHost: new ElementMock() });
  return { layers, dispose, setZoom: (value) => { zoom = value; }, fire: (type, event) => handlers.get(type)?.(event),
    toggle: () => controls.children[0].children[0].click(),
    close: () => details.children[0].children[0].children[1].click(),
    panel: details.children[0], status: controls.children[0].children[1], boundaryStatus: controls.children[0].children[2] };
}
const click = () => ({ pixel: [10, 10], coordinate: api.transform([126.9775, 37.5665], 'EPSG:4326', 'EPSG:3857') });
const selectionBatch = () => api.parseCadastral(response({ page: { current: 1, size: 5, total: 1 } }), 5);
test('OFF·줌 15 미만은 POINT 요청 없음, ON만으로 BOX 요청 없음', () => {
  const ui = setupMap(); ui.fire('singleclick', click()); assert.equal(parcelOfflineMocks.calls.length, 0);
  ui.toggle(); ui.setZoom(14.999); ui.fire('singleclick', click()); assert.equal(parcelOfflineMocks.calls.length, 0);
  assert.equal(ui.boundaryStatus.textContent, ''); ui.dispose();
});
test('POINT 중복 억제, 지도 이동 후 응답·선택·상세 유지, 닫기 정리', async () => {
  const ui = setupMap(); ui.toggle(); ui.setZoom(17); const event = click();
  ui.fire('singleclick', event); ui.fire('singleclick', event); assert.equal(parcelOfflineMocks.calls.length, 1);
  const signal = parcelOfflineMocks.calls[0].signal;
  assert.ok(Math.abs(parcelOfflineMocks.calls[0].coordinate[0] - 126.9775) < 1e-8);
  ui.fire('movestart'); ui.fire('moveend'); assert.equal(signal.aborted, false);
  parcelOfflineMocks.point.resolve(selectionBatch()); await tick();
  assert.equal(ui.layers[1].getSource().getFeatures().length, 1); assert.equal(ui.panel.hidden, false);
  const message = ui.status.textContent; ui.fire('movestart'); ui.fire('moveend');
  assert.equal(ui.status.textContent, message); assert.equal(ui.layers[1].getSource().getFeatures().length, 1);
  ui.close(); assert.equal(ui.panel.hidden, true); assert.equal(ui.layers[1].getSource().getFeatures().length, 0); ui.dispose();
});
test('OFF 뒤 늦은 POINT 응답은 선택·패널 갱신 불가', async () => {
  const ui = setupMap(); ui.toggle(); ui.fire('singleclick', click()); const signal = parcelOfflineMocks.calls[0].signal;
  ui.toggle(); assert.equal(signal.aborted, true); parcelOfflineMocks.point.resolve(selectionBatch()); await tick();
  assert.equal(ui.panel.hidden, true); assert.equal(ui.layers[1].getSource().getFeatures().length, 0);
  assert.equal(ui.layers[0].getVisible(), false); ui.dispose();
});
test('새 POINT 뒤 이전 응답이 먼저 와도 화면 갱신 방지', async () => {
  const ui = setupMap(); ui.toggle(); ui.fire('singleclick', click()); const first = parcelOfflineMocks.point;
  parcelOfflineMocks.point = deferred(); const next = click(); next.coordinate[0] += 1; ui.fire('singleclick', next);
  assert.equal(parcelOfflineMocks.calls[0].signal.aborted, true);
  first.resolve(selectionBatch()); await tick(); assert.equal(ui.panel.hidden, true);
  parcelOfflineMocks.point.resolve(selectionBatch()); await tick(); assert.equal(ui.panel.hidden, false); ui.dispose();
});

// 테스트 전용 메모리 번들에서만 자동 조회 분기를 실행한다.
// 기존 스케줄러 회귀는 테스트 번들만 활성화하고 개발용 1회 제한은 별도 검사한다.
globalThis.boxSchedulerMocks = { api, boxCalls: [], pointCalls: [] };
const schedulerPlugins = [{
  name: 'offline-box-scheduler', setup(builder) {
    builder.onLoad({ filter: /[/\\]config[/\\]parcel\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      assert.match(source, /autoBoundaryQueryEnabled: import.meta.env.VITE_CADASTRAL_AUTO_BOX === 'true'/);
      return { loader: 'ts', contents: source.replace(/autoBoundaryQueryEnabled:[^\r\n]+/, 'autoBoundaryQueryEnabled: true,') };
    });
    builder.onLoad({ filter: /[/\\]services[/\\]vworld[/\\]cadastral\.ts$/ }, () => ({ loader: 'ts', resolveDir: root, contents: `
      import { ParcelError } from './src/services/vworld/parcelValidation';
      export const cadastralSource = 'https://www.vworld.kr/';
      export function validateParcelBox(box) {
        try { globalThis.boxSchedulerMocks.api.validateParcelBox(box); }
        catch (error) {
          // 별도 번들의 동일 오류 타입을 현재 번들의 타입으로 연결한다. 메시지·종류는 유지한다.
          if (error instanceof globalThis.boxSchedulerMocks.api.ParcelError)
            throw new ParcelError(error.message.replace(/^\\[[A-Z_]+\\] /, ''), error.kind);
          throw error;
        }
      }
      export function createCadastralProvider() {
        function request(list, args, signal) {
          let resolve, reject;
          const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
          list.push({ args: [...args], signal, at: performance.now(), resolve, reject });
          // abort 이후에도 늦은 응답이 올 수 있도록 자동 reject하지 않는다.
          return promise;
        }
        return {
          point(coordinate, signal) { return request(globalThis.boxSchedulerMocks.pointCalls, coordinate, signal); },
          box(box, signal) { return request(globalThis.boxSchedulerMocks.boxCalls, box, signal); }
        };
      }
    ` }));
  },
}];
const schedulerModule = await bundle(`export { cadastralFeature } from './src/features/cadastral';`, schedulerPlugins);

globalThis.selectedAttributeMocks = { calls: [] };
const attributesModule = await bundle(`export { cadastralFeature } from './src/features/cadastral';`, [
  ...schedulerPlugins, { name: 'offline-selected-attributes', setup(builder) {
    builder.onLoad({ filter: /[/\\]services[/\\]vworld[/\\]attributeRequest\.ts$/ }, () => ({ loader: 'ts', contents: `
      export function attributeFailure() { return '모의 속성 조회 실패'; }
      export function requestParcelAttribute(service, id, auth, signal, year, pageNo) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        globalThis.selectedAttributeMocks.calls.push({service, id, signal, year, pageNo, resolve, reject});
        return promise;
      }
    ` }));
  } },
]);

const panelText = (node) => [node.textContent, ...node.children.map(panelText)].join(' ');
const byClass = (node, name) => [ ...((node.className ?? '').split(/\s+/).includes(name) ? [node] : []), ...node.children.flatMap((child) => byClass(child, name)) ];
const ledgerPayload = (pnuValue = id, area = '944.2') => ({ ladfrlVOList: { totalCount: '1', field: [{ pnu: pnuValue, lndcgrCode: '08', lndcgrCodeNm: '대', lndpclAr: area, lastUpdtDt: '2026-02-05' }] } });
const pricesPayload = (pnuValue = id) => ({ indvdLandPrices: { totalCount: '2', numOfRows: '10', pageNo: '1', field:
  ['2025-06-18', '2026-02-05'].map((lastUpdtDt) => ({ pnu: pnuValue, stdrYear: '2025', stdrMt: '01', pblntfPclnd: '5714000', pblntfDe: '2025-04-30', lastUpdtDt })) } });
async function startSelected(f) {
  await f.clock.advance(0); // OpenLayers 레이어의 source-ready 초기 타이머를 먼저 실행한다.
  selectedAttributeMocks.calls = []; f.toggle(); f.fire('singleclick', click());
  f.points[0].resolve(selectionBatch()); await tick();
  assert.equal(selectedAttributeMocks.calls.length, 2);
  return selectedAttributeMocks.calls;
}
test('지도 선택: POINT 성공 이후만 속성 2회, 토지임야 먼저 표시·갱신일 다른 가격 2행 보존', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    selectedAttributeMocks.calls = []; f.toggle(); f.fire('moveend'); await f.clock.advance(350);
    assert.equal(selectedAttributeMocks.calls.length, 0);
    f.fire('singleclick', click()); assert.equal(selectedAttributeMocks.calls.length, 0);
    f.points[0].resolve(selectionBatch()); await tick();
    const [ledger, price] = selectedAttributeMocks.calls;
    assert.equal(price.year, undefined); assert.equal(price.pageNo, 1); assert.equal(ledger.year, undefined);
    ledger.resolve(ledgerPayload()); await tick();
    assert.match(panelText(f.panel), /944.2/); assert.match(panelText(f.panel), /확인 중/);
    price.resolve(pricesPayload()); await tick();
    const content = panelText(f.panel);
    assert.equal(byClass(f.panel, 'parcel-price-card').length, 1);
    assert.equal(byClass(f.panel, 'parcel-data-details').length, 0);
    assert.match(content, /5,714,000/); assert.match(content, /최신 가용 개별공시지가/);
    f.fire('movestart'); f.fire('moveend'); await f.clock.advance(2000);
    assert.equal(selectedAttributeMocks.calls.length, 2); assert.match(panelText(f.panel), /944.2/);
  } finally { f.finish(); }
});

const uiPriceBatch = (changes = {}) => ({ records: ['2025-06-18', '2026-02-05'].map((updatedAt) => ({
  pnu: id, year: '2025', month: '01', pricePerSquareMeter: 415200, publishedAt: '2025-04-30', updatedAt,
})), returnedCount: 2, totalCount: 2, pageSize: 10, pageNo: 1, completeness: 'complete', duplicatesRemoved: 0, fields: [], ...changes });
test('패널 UI: 지번 강조·작은 PNU·2열 카드·자료 상세 제거', () => {
  const ui = api.createParcelPanel(() => {}, () => {});
  ui.showSelection('1120011300105280006', '528-6', '2025');
  ui.renderLedger({ status: 'ok', value: { pnu: '1120011300105280006', landCategoryCode: '23', landCategoryName: '공원', registeredArea: 2659.7, updatedAt: '2026-02-05' } });
  assert.equal(byClass(ui.panel, 'parcel-lot-number')[0].textContent, '528-6');
  assert.match(byClass(ui.panel, 'parcel-pnu')[0].textContent, /1120011300105280006/);
  const cards = byClass(ui.panel, 'parcel-facts')[0]; assert.equal(cards.children.length, 2);
  assert.match(panelText(cards), /공원/); assert.match(panelText(cards), /2,659.7 ㎡/);
  assert.equal(byClass(ui.panel, 'parcel-data-details').length, 0);
  assert.equal(panelText(ui.panel).includes('자료 상세'), false);
  ui.dispose();
});
test('패널 UI: 갱신일만 다른 가격은 한 개 요약, 입력 원본 2건 보존', () => {
  const ui = api.createParcelPanel(() => {}, () => {}); ui.showSelection(id, '528-6', '2025');
  const batch = uiPriceBatch(), original = JSON.stringify(batch);
  ui.renderPrice({ status: 'ok', value: batch });
  const cards = byClass(ui.panel, 'parcel-price-card'); assert.equal(cards.length, 1);
  assert.match(panelText(cards[0]), /415,200 원\/㎡/); assert.match(panelText(cards[0]), /2025년 기준/); assert.equal(panelText(cards[0]).includes('01월'), false);
  assert.equal(byClass(ui.panel, 'parcel-data-details').length, 0);
  assert.equal(batch.records.length, 2); assert.equal(JSON.stringify(batch), original);
  assert.equal(panelText(ui.panel).includes('연도별 이력'), false); ui.dispose();
});

function renderHistoryUi(batch) {
  const ui = api.createParcelPanel(() => {}, () => {}); ui.showSelection(id, '528-6');
  ui.renderPrice({ status: 'ok', value: batch }, { batch, phase: 'complete', latestYear: batch.records.reduce((year, row) => row.year > year ? row.year : year, ''),
    pagesLoaded: 1, expectedPages: 1, warning: null, statistics: api.priceStatistics(batch.records, true) });
  return ui;
}

test('모던 UI: 레이어 토글의 상태·접근성·기존 콜백 유지', () => {
  let toggles = 0, closes = 0;
  const ui = api.createParcelPanel(() => toggles++, () => closes++);
  const button = ui.controls.children[0];
  assert.equal(button.attributes.get('aria-pressed'), 'false');
  assert.equal(byClass(ui.controls, 'parcel-layer-icon')[0].attributes.get('aria-hidden'), 'true');
  assert.equal(byClass(ui.controls, 'parcel-toggle-state')[0].textContent, 'OFF');
  ui.setEnabled(true);
  assert.equal(button.attributes.get('aria-pressed'), 'true');
  assert.equal(button.attributes.get('aria-label'), '지적도 끄기');
  assert.equal(byClass(ui.controls, 'parcel-toggle-state')[0].textContent, 'ON');
  button.click(); ui.panel.children[0].children[1].click();
  assert.equal(toggles, 1); assert.equal(closes, 1);
  ui.setEnabled(false); assert.equal(byClass(ui.controls, 'parcel-toggle-state')[0].textContent, 'OFF');
  ui.dispose();
});

for (const [price, expected, rate] of [[436000, 'price-rise', '+5.01%'], [400000, 'price-fall', '-3.66%'], [415200, 'price-steady', '0.00%']]) {
  test(`모던 UI: 증감률 ${rate} 표시 색상 구분·원본 유지`, () => {
    const batch = uiPriceBatch(); batch.records.push({ ...batch.records[0], year: '2026', pricePerSquareMeter: price });
    const original = JSON.stringify(batch), ui = renderHistoryUi(batch);
    const change = byClass(ui.panel, 'parcel-price-change')[0];
    assert.ok(change.className.includes(expected)); assert.match(change.textContent, new RegExp(rate.replace(/[+.%]/g, '\\$&')));
    assert.ok(byClass(ui.panel, expected).length >= 2);
    assert.equal(JSON.stringify(batch), original);
    assert.equal(byClass(ui.panel, 'parcel-price-history')[0].hidden, false);
    ui.dispose();
  });
}
test('공시지가 UI: 일반 요약·이력에서 기준월만 숨기고 연도·가격·증감률·공시일 유지', () => {
  const batch = uiPriceBatch(); batch.records.push({ ...batch.records[0], year: '2026', pricePerSquareMeter: 436000, publishedAt: '2026-04-30' });
  const original = JSON.stringify(batch); const ui = renderHistoryUi(batch);
  const summary = panelText(byClass(ui.panel, 'parcel-prices')[0]), table = panelText(byClass(ui.panel, 'parcel-history-table')[0]);
  for (const content of [summary, table]) {
    assert.equal(content.includes('01월'), false); assert.match(content, /2026/); assert.match(content, /436,000/); assert.match(content, /\+5.01%/); assert.match(content, /2026-04-30/);
  }
  assert.equal(batch.records[0].month, '01');
  assert.equal(JSON.stringify(batch), original); ui.dispose();
});
test('공시지가 UI: 같은 연도에 다른 기준월이 있으면 요약·이력에 구분 표시', () => {
  const batch = uiPriceBatch(); Object.assign(batch.records[1], { month: '07', pricePerSquareMeter: 420000, publishedAt: '2025-10-31' });
  const original = JSON.stringify(batch); const ui = renderHistoryUi(batch);
  for (const content of [panelText(byClass(ui.panel, 'parcel-prices')[0]), panelText(byClass(ui.panel, 'parcel-history-table')[0])]) {
    assert.match(content, /01월/); assert.match(content, /07월/); assert.match(content, /415,200/); assert.match(content, /420,000/);
  }
  assert.equal(byClass(ui.panel, 'parcel-price-card').length, 2); assert.equal(JSON.stringify(batch), original); ui.dispose();
});
test('공시지가 UI: 다른 연도 사이의 월 차이는 기존 비교 주의만 유지', () => {
  const batch = uiPriceBatch(); batch.records.push({ ...batch.records[0], year: '2026', month: '07', pricePerSquareMeter: 436000, publishedAt: '2026-10-31' });
  const ui = renderHistoryUi(batch); const table = panelText(byClass(ui.panel, 'parcel-history-table')[0]);
  assert.equal(table.includes('01월'), false); assert.equal(table.includes('07월'), false); assert.match(table, /기준월 다름/); assert.match(table, /\+5.01%/); ui.dispose();
});
for (const changes of [{ month: '07' }, { publishedAt: '2025-10-31' }, { pricePerSquareMeter: 500000 }, { pnu: '1114010300100310001' }]) {
  test(`패널 UI: ${Object.keys(changes)[0]} 다른 가격을 임의로 합치지 않음`, () => {
    const ui = api.createParcelPanel(() => {}, () => {}); ui.showSelection(id, '528-6', '2025');
    const batch = uiPriceBatch(); Object.assign(batch.records[1], changes);
    ui.renderPrice({ status: 'ok', value: batch }); assert.equal(byClass(ui.panel, 'parcel-price-card').length, 2); ui.dispose();
  });
}
test('패널 UI: 부분·불명확 응답 경고는 접힌 상세 밖에 유지', () => {
  const ui = api.createParcelPanel(() => {}, () => {}); ui.showSelection(id, '528-6', '2025');
  for (const completeness of ['partial', 'unknown']) {
    ui.renderPrice({ status: 'ok', value: uiPriceBatch({ completeness }) });
    assert.equal(byClass(ui.panel, 'parcel-prices')[0].children.some((node) => node.className === 'parcel-data-warning'), true);
  }
  ui.renderPrice({ status: 'error', message: '공시지가 조회 실패' }); assert.match(panelText(ui.panel), /공시지가 조회 실패/);
  assert.equal(byClass(ui.panel, 'parcel-price-card').length, 0); ui.dispose();
});
test('패널 UI: 새 선택·닫기 시 상세 초기화, API 문자열은 텍스트로 표시', () => {
  const ui = api.createParcelPanel(() => {}, () => {}); ui.showSelection(id, '<img src=x onerror=alert(1)>', '2025');
  assert.equal(byClass(ui.panel, 'parcel-lot-number')[0].textContent, '<img src=x onerror=alert(1)>');
  ui.renderPrice({ status: 'ok', value: uiPriceBatch() });
  ui.showSelection(id, '새 필지', '2025'); assert.equal(panelText(ui.panel).includes('415,200'), false);
  ui.clear(); assert.equal(ui.panel.hidden, true); assert.equal(panelText(ui.panel).includes('2025-06-18'), false); ui.dispose();
});
for (const failure of ['ledger', 'price']) {
  test(`속성 독립성: ${failure} 실패해도 다른 서비스 완료 결과 유지`, async () => {
    const f = schedulerFixture(attributesModule);
    try {
      const calls = await startSelected(f);
      for (const call of calls) {
        if (call.service === failure) call.reject(new Error('DO_NOT_SHOW'));
        else call.resolve(call.service === 'ledger' ? ledgerPayload() : pricesPayload());
      }
      await tick(); const content = panelText(f.panel);
      assert.match(content, failure === 'ledger' ? /모의 속성 조회 실패/ : /페이지 조회에 실패/); assert.equal(content.includes('DO_NOT_SHOW'), false);
      assert.match(content, failure === 'ledger' ? /5,714,000/ : /944.2/);
      assert.equal(f.layers[1].getSource().getFeatures().length, 1);
    } finally { f.finish(); }
  });
}
test('연속 필지 선택: 이전 속성 응답이 현재 필지를 덮지 않음', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    const old = [...await startSelected(f)];
    const event = click(); event.coordinate[0] += 1; f.fire('singleclick', event);
    assert.equal(old[0].signal.aborted, true);
    const next = selectionBatch(); const nextId = '1114010300100310001'; next.features[0].set('pnu', nextId);
    f.points[1].resolve(next); await tick();
    const fresh = selectedAttributeMocks.calls.slice(2);
    fresh[0].resolve(ledgerPayload(nextId, '222')); fresh[1].resolve(pricesPayload(nextId)); await tick();
    old[0].resolve(ledgerPayload()); old[1].resolve(pricesPayload()); await tick();
    const content = panelText(f.panel); assert.match(content, /222/); assert.equal(content.includes('944.2'), false);
    assert.match(content, new RegExp(nextId));
  } finally { f.finish(); }
});
test('속성 대기 중 OFF/ON: 완료 결과 보존·미완료 취소·추가 속성 요청 없음', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    const [ledger, price] = await startSelected(f);
    ledger.resolve(ledgerPayload()); await tick(); f.toggle(); assert.equal(price.signal.aborted, true);
    f.toggle(); assert.match(panelText(f.panel), /944.2/); assert.match(panelText(f.panel), /조회가 취소/);
    price.resolve(pricesPayload()); await tick();
    assert.equal(panelText(f.panel).includes('5,714,000'), false); assert.equal(selectedAttributeMocks.calls.length, 2);
  } finally { f.finish(); }
});
test('POINT 결과 없음은 속성 0회, 패널 닫기 후 늦은 속성은 미표시', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    await f.clock.advance(0);
    selectedAttributeMocks.calls = []; f.toggle(); f.fire('singleclick', click());
    f.points[0].resolve(batch()); await tick(); assert.equal(selectedAttributeMocks.calls.length, 0);
    f.fire('singleclick', click()); f.points[1].resolve(selectionBatch()); await tick();
    const calls = [...selectedAttributeMocks.calls]; f.close();
    calls[0].resolve(ledgerPayload()); calls[1].resolve(pricesPayload()); await tick();
    assert.equal(f.panel.hidden, true); assert.equal(panelText(f.panel).includes('5,714,000'), false);
    assert.equal(calls[0].signal.aborted, true);
  } finally { f.finish(); }
});

const multiPagePrices = (pageNo, pnuValue = id) => {
  const all = [
    ...Array.from({ length: 10 }, (_, index) => ({ pnu: pnuValue, stdrYear: String(2017 + Math.min(index, 7)), stdrMt: '01',
      pblntfPclnd: index >= 7 ? '396300' : String(250000 + index * 10000), pblntfDe: `${2017 + Math.min(index, 7)}-04-30`, lastUpdtDt: index === 8 ? '2026-02-05' : '2025-06-18' })),
    ...['2025-06-18', '2026-02-05'].map((lastUpdtDt) => ({ pnu: pnuValue, stdrYear: '2025', stdrMt: '01', pblntfPclnd: '415200', pblntfDe: '2025-04-30', lastUpdtDt })),
    { pnu: pnuValue, stdrYear: '2026', stdrMt: '01', pblntfPclnd: '436000', pblntfDe: '2026-04-30', lastUpdtDt: '2026-05-01' },
  ];
  return { indvdLandPrices: { totalCount: '13', numOfRows: '10', pageNo: String(pageNo), field: all.slice((pageNo - 1) * 10, pageNo * 10) } };
};
test('지도 이력: 펼치기 전 최신 확인용 2페이지 순차 조회·펼치기 후 추가 요청 없음', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    const calls = await startSelected(f); calls[0].resolve(ledgerPayload()); calls[1].resolve(multiPagePrices(1)); await tick();
    assert.equal(selectedAttributeMocks.calls.length, 3); assert.equal(selectedAttributeMocks.calls[2].pageNo, 2);
    assert.equal(byClass(f.panel, 'parcel-price-card').some((card) => panelText(card).includes('436,000')), false);
    assert.equal(panelText(f.panel).includes('+5.01%'), false);
    const history = byClass(f.panel, 'parcel-price-history')[0]; history.open = true;
    assert.equal(selectedAttributeMocks.calls.length, 3);
    selectedAttributeMocks.calls[2].resolve(multiPagePrices(2)); await tick();
    assert.equal(history.open, true); assert.match(panelText(f.panel), /최신 가용 개별공시지가 · 2026년/);
    assert.match(panelText(byClass(f.panel, 'parcel-price-card')[0]), /436,000/);
    assert.match(panelText(f.panel), /\+5.01%/);
    const table = byClass(f.panel, 'parcel-history-table')[0]; assert.match(panelText(table.children[2].children[0]), /2026/);
    history.open = false; history.open = true; assert.equal(selectedAttributeMocks.calls.length, 3);
    const event = click(); event.coordinate[0] += 1; f.fire('singleclick', event); f.points[1].resolve(selectionBatch()); await tick();
    assert.equal(selectedAttributeMocks.calls.length, 4); assert.equal(selectedAttributeMocks.calls[3].service, 'ledger');
    assert.match(panelText(f.panel), /436,000/); selectedAttributeMocks.calls[3].resolve(ledgerPayload()); await tick();
  } finally { f.finish(); }
});
test('중간 이력 요청 중 새 선택: 이전 2페이지는 무시하고 새 필지만 표시', async () => {
  const f = schedulerFixture(attributesModule);
  try {
    const calls = await startSelected(f); calls[0].resolve(ledgerPayload()); calls[1].resolve(multiPagePrices(1)); await tick();
    const oldPage = selectedAttributeMocks.calls[2]; const event = click(); event.coordinate[0] += 1; f.fire('singleclick', event);
    assert.equal(oldPage.signal.aborted, true);
    const next = selectionBatch(), nextId = '1114010300100310001'; next.features[0].set('pnu', nextId);
    f.points[1].resolve(next); await tick();
    const fresh = selectedAttributeMocks.calls.slice(3);
    fresh[0].resolve(ledgerPayload(nextId, '222')); fresh[1].resolve(pricesPayload(nextId)); await tick();
    oldPage.resolve(multiPagePrices(2)); await tick();
    assert.match(panelText(f.panel), /222/); assert.equal(panelText(f.panel).includes('436,000'), false);
  } finally { f.finish(); }
});

function fakeClock() {
  const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    now: Date.now, performance: Object.getOwnPropertyDescriptor(globalThis, 'performance') };
  let time = 0, sequence = 0;
  const tasks = new Map();
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = ++sequence; tasks.set(id, { at: time + Math.max(0, Number(delay)), callback }); return id;
  };
  globalThis.clearTimeout = (id) => { tasks.delete(id); };
  Date.now = () => 100_000 + time;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => time } });
  return {
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        tasks.delete(next[0]); time = next[1].at; next[1].callback(); await tick();
      }
      time = target; await tick();
    },
    pending: () => tasks.size,
    restore() {
      globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.now;
      if (original.performance) Object.defineProperty(globalThis, 'performance', original.performance);
      else delete globalThis.performance;
    },
  };
}

function schedulerFixture(featureModule = schedulerModule) {
  const clock = fakeClock();
  const state = { zoom: 18, size: [640, 480], resolution: 0.5, rotation: 0,
    center: api.transform([126.9775, 37.5665], 'EPSG:4326', 'EPSG:3857'), interacting: false, animating: false };
  const handlers = new Map(), layers = [];
  const view = {
    getZoom: () => state.zoom, getInteracting: () => state.interacting, getAnimating: () => state.animating,
    calculateExtent(size) {
      const c = Math.abs(Math.cos(state.rotation)), s = Math.abs(Math.sin(state.rotation));
      const width = state.resolution * (size[0] * c + size[1] * s);
      const height = state.resolution * (size[0] * s + size[1] * c);
      return [state.center[0] - width / 2, state.center[1] - height / 2, state.center[0] + width / 2, state.center[1] + height / 2];
    },
  };
  const map = { getView: () => view, getSize: () => state.size,
    on(type, listener) { handlers.set(type, listener); return { target: { removeEventListener() {} }, type, listener }; },
    addLayer(layer) { layers.push(layer); }, removeLayer() {}, hasFeatureAtPixel: () => false };
  const controls = new ElementMock(), details = new ElementMock();
  boxSchedulerMocks.boxCalls = []; boxSchedulerMocks.pointCalls = [];
  const dispose = featureModule.cadastralFeature.mount({ map, parcelControlsHost: controls, parcelPanelHost: details,
    searchHost: new ElementMock(), vworldApiKey: '' });
  return { state, clock, layers, fire: (type, value) => handlers.get(type)?.(value),
    boxes: boxSchedulerMocks.boxCalls, points: boxSchedulerMocks.pointCalls,
    toggle: () => controls.children[0].children[0].click(), close: () => details.children[0].children[0].children[1].click(),
    status: controls.children[0].children[1], boundaryStatus: controls.children[0].children[2], panel: details.children[0],
    finish() { try { dispose(); assert.equal(clock.pending(), 0); } finally { clock.restore(); } } };
}
function schedulerTest(name, run) {
  test(name, async () => {
    const fixture = schedulerFixture();
    try { await run(fixture); } finally { fixture.finish(); }
  });
}

schedulerTest('BOX 이동 종료 349ms는 0회, 350ms에 1회', async (f) => {
  f.toggle(); f.fire('movestart'); await f.clock.advance(1000); assert.equal(f.boxes.length, 0);
  f.fire('moveend'); await f.clock.advance(349); assert.equal(f.boxes.length, 0);
  await f.clock.advance(1); assert.equal(f.boxes.length, 1); assert.equal(f.boxes[0].at, 1350);
});
schedulerTest('BOX 이동 종료 반복은 350ms 지연을 다시 계산', async (f) => {
  f.toggle(); await f.clock.advance(200); f.fire('moveend');
  await f.clock.advance(349); assert.equal(f.boxes.length, 0); await f.clock.advance(1); assert.equal(f.boxes.length, 1);
});
schedulerTest('BOX 최소 요청 간격은 정확히 1.5초', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch()); await tick();
  f.fire('movestart'); f.state.center[0] += 50; f.fire('moveend');
  await f.clock.advance(350); assert.equal(f.boxes.length, 1);
  await f.clock.advance(1149); assert.equal(f.boxes.length, 1);
  await f.clock.advance(1); assert.equal(f.boxes.length, 2); assert.equal(f.boxes[1].at - f.boxes[0].at, 1500);
});
schedulerTest('진행 중 동일 BOX 요청 중복 억제', async (f) => {
  f.toggle(); await f.clock.advance(350); f.fire('moveend'); await f.clock.advance(2000);
  assert.equal(f.boxes.length, 1); assert.equal(f.boxes[0].signal.aborted, false);
});
schedulerTest('완료한 동일 BOX는 네트워크 대신 캐시 재사용', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature(1)])); await tick();
  f.fire('movestart'); f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1); assert.equal(f.boundaryStatus.textContent, '');
  assert.equal(f.layers[0].getSource().getFeatures().length, 1);
});
schedulerTest('진행 중 이동하면 늦은 이전 BOX 응답 무시', async (f) => {
  f.toggle(); await f.clock.advance(350); const old = f.boxes[0];
  f.fire('movestart'); f.state.center[0] += 50; f.fire('moveend'); assert.equal(old.signal.aborted, true);
  old.resolve(batch([feature(1)])); await tick(); assert.equal(f.layers[0].getSource().getFeatures().length, 0);
  await f.clock.advance(1500); assert.equal(f.boxes.length, 2);
  f.boxes[1].resolve(batch([feature(2)])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures()[0].get('pnu'), String(2).padStart(19, '0'));
});
schedulerTest('BOX 재응답 후 도착한 이전 응답도 최신 경계를 덮지 못함', async (f) => {
  f.toggle(); await f.clock.advance(350); const old = f.boxes[0];
  f.fire('movestart'); f.state.center[0] += 50; f.fire('moveend'); await f.clock.advance(1500);
  f.boxes[1].resolve(batch([feature(2)])); await tick(); old.resolve(batch([feature(1)])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures()[0].getId(), '2');
});
schedulerTest('OFF는 350ms 예약 타이머 취소', async (f) => {
  f.toggle(); await f.clock.advance(349); f.toggle(); assert.equal(f.clock.pending(), 0);
  await f.clock.advance(5000); assert.equal(f.boxes.length, 0);
});
schedulerTest('OFF는 요청 간격 대기 타이머도 취소', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch()); await tick();
  f.fire('movestart'); f.state.center[0] += 50; f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.clock.pending(), 1); f.toggle(); assert.equal(f.clock.pending(), 0);
  await f.clock.advance(5000); assert.equal(f.boxes.length, 1);
});
schedulerTest('OFF 뒤 늦은 BOX 응답은 경계·안내를 다시 표시하지 않음', async (f) => {
  f.toggle(); await f.clock.advance(350); const request = f.boxes[0]; f.toggle();
  assert.equal(request.signal.aborted, true); request.resolve(batch([feature()])); await tick();
  assert.equal(f.layers[0].getVisible(), false); assert.equal(f.layers[0].getSource().getFeatures().length, 0);
  assert.equal(f.boundaryStatus.textContent, '');
});
schedulerTest('POINT 클릭·닫기는 진행 중 BOX를 취소하지 않음', async (f) => {
  f.toggle(); await f.clock.advance(350); f.fire('singleclick', click()); assert.equal(f.points.length, 1);
  assert.equal(f.boxes[0].signal.aborted, false); f.close(); assert.equal(f.points[0].signal.aborted, true);
  assert.equal(f.boxes[0].signal.aborted, false); f.boxes[0].resolve(batch([feature()])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures().length, 1);
});
schedulerTest('BOX 완료는 진행 중 POINT를 취소하거나 로딩 문구를 덮지 않음', async (f) => {
  f.toggle(); await f.clock.advance(350); f.fire('singleclick', click()); const message = f.status.textContent;
  f.boxes[0].resolve(batch([feature()])); await tick();
  assert.equal(f.status.textContent, message); assert.equal(f.points[0].signal.aborted, false);
  f.points[0].resolve(selectionBatch()); await tick(); assert.equal(f.panel.hidden, false);
});
schedulerTest('BOX 오류는 POINT 선택·패널·상태를 유지하고 자동 재시도 없음', async (f) => {
  f.toggle(); f.fire('singleclick', click()); f.points[0].resolve(selectionBatch()); await tick();
  const message = f.status.textContent; await f.clock.advance(350); f.boxes[0].reject(new Error('모의 전송 실패')); await tick();
  assert.match(f.boundaryStatus.textContent, /조회하지 못/); assert.equal(f.status.textContent, message);
  assert.equal(f.panel.hidden, false); assert.equal(f.layers[1].getSource().getFeatures().length, 1);
  await f.clock.advance(5000); assert.equal(f.boxes.length, 1);
  f.fire('moveend'); await f.clock.advance(350); assert.equal(f.boxes.length, 1);
});
for (const completeness of ['partial', 'unknown']) {
  schedulerTest(`BOX ${completeness} 안내는 POINT·이동 종료 후에도 완전 응답으로 바뀌지 않음`, async (f) => {
    f.toggle(); await f.clock.advance(350);
    f.boxes[0].resolve({ features: [feature()], completeness, truncated: completeness === 'partial' }); await tick();
    const pattern = completeness === 'partial' ? /일부/ : /미확인/;
    assert.match(f.boundaryStatus.textContent, pattern);
    f.fire('singleclick', click()); f.points[0].resolve(selectionBatch()); await tick(); assert.match(f.boundaryStatus.textContent, pattern);
    f.fire('movestart'); f.fire('moveend'); await f.clock.advance(350);
    assert.equal(f.boxes.length, 1); assert.match(f.boundaryStatus.textContent, pattern);
  });
}
schedulerTest('줌 15 미만은 0회, 줌 15 이상 작은 BOX는 조회 후보', async (f) => {
  f.state.zoom = 14.999; f.toggle(); await f.clock.advance(350); assert.equal(f.boxes.length, 0);
  f.fire('movestart'); f.state.zoom = 15; f.fire('moveend'); await f.clock.advance(350); assert.equal(f.boxes.length, 1);
  f.fire('singleclick', click()); assert.equal(f.points.length, 1);
});
schedulerTest('BOX 면적 초과는 요청 함수 호출 0회', async (f) => {
  f.state.size = [3000, 3000]; f.state.resolution = 1; f.toggle(); await f.clock.advance(5000);
  assert.equal(f.boxes.length, 0); assert.match(f.boundaryStatus.textContent, /5㎢/);
});
schedulerTest('회전으로 전송 BOX 면적이 커지면 조건을 재평가해 차단', async (f) => {
  f.state.size = [4200, 100]; f.state.resolution = 1; f.toggle(); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1); f.boxes[0].resolve(batch()); await tick();
  f.fire('movestart'); f.state.rotation = Math.PI / 4; f.fire('moveend'); await f.clock.advance(2000);
  assert.equal(f.boxes.length, 1); assert.match(f.boundaryStatus.textContent, /5㎢/);
});
schedulerTest('화면 크기 변경은 이전 요청 무효화 및 면적 재평가', async (f) => {
  f.toggle(); await f.clock.advance(350); const old = f.boxes[0];
  f.state.size = [3000, 3000]; f.state.resolution = 1; f.fire('change:size');
  assert.equal(old.signal.aborted, true); old.resolve(batch([feature()])); await tick();
  await f.clock.advance(2000); assert.equal(f.boxes.length, 1); assert.equal(f.layers[0].getSource().getFeatures().length, 0);
  assert.match(f.boundaryStatus.textContent, /5㎢/);
});
schedulerTest('화면 확대 수준·범위 축소 후 작은 BOX는 재평가하여 요청', async (f) => {
  f.state.size = [3000, 3000]; f.state.resolution = 1; f.toggle(); await f.clock.advance(350); assert.equal(f.boxes.length, 0);
  f.fire('movestart'); f.state.zoom = 19; f.state.resolution = 0.1; f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1);
});
schedulerTest('캐시 TTL 만료 전 재사용·만료 후 사용자 이벤트로 갱신', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch()); await tick();
  await f.clock.advance(59_000); f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1); assert.match(f.boundaryStatus.textContent, /필지 경계가 없습니다/);
  await f.clock.advance(1000); f.fire('moveend'); await f.clock.advance(350); assert.equal(f.boxes.length, 2);
});
test('실제 설정 소스는 명시적 true를 요구', async () => {
  const source = await readFile(new URL('../src/config/parcel.ts', import.meta.url), 'utf8');
  assert.match(source, /autoBoundaryQueryEnabled: import.meta.env.VITE_CADASTRAL_AUTO_BOX === 'true'/);
  assert.equal(api.parcelConfig.autoBoundaryQueryEnabled, false);
  assert.equal(api.parcelConfig.maxAreaSquareMeters, 5_000_000);
  assert.equal(api.parcelConfig.maxFeatures, 1000);
});

// 수동 검증도 실제 provider/검증기를 사용하고 JSONP 전송 경계만 가짜 함수로 바꾼다.
let manualTestSequence = 0;
globalThis.manualBoxMocks = { calls: [], payload: undefined, failure: false };
async function manualModule(development, probe = false) {
  const instance = ++manualTestSequence;
  return bundle(`
    export { ${probe ? 'runManualBoxOnce' : 'createCadastralProvider'} } from '${probe ? './src/dev/parcelBoxProbe' : './src/services/vworld/cadastral'}';
    export const testInstance = ${instance};
  `, [{ name: 'offline-manual-box', setup(builder) {
    builder.onLoad({ filter: /[/\\]services[/\\]vworld[/\\]cadastralJsonp\.ts$/ }, () => ({ loader: 'ts', contents: `
      export async function requestCadastralJsonp(parameters, signal) {
        globalThis.manualBoxMocks.calls.push(new URLSearchParams(parameters));
        if (globalThis.manualBoxMocks.failure) throw new Error('모의 전송 실패');
        return globalThis.manualBoxMocks.payload;
      }
    ` }));
    builder.onLoad({ filter: /[/\\]config[/\\]env\.ts$/ }, () => ({ loader: 'ts', contents: `
      export function readEnvironment() { return { vworldApiKey: 'offline-test-key', vworldDomain: 'https://example.invalid/registered/' }; }
    ` }));
  } }], { 'import.meta.env.DEV': development ? 'true' : 'false' });
}
const smallManualBox = [126.977, 37.566, 126.978, 37.567];
function resetManual() { manualBoxMocks.calls = []; manualBoxMocks.payload = response(); manualBoxMocks.failure = false; }
test('개발 환경도 일반 BOX 실행은 기존처럼 차단', async () => {
  resetManual(); const module = await manualModule(true);
  assert.throws(() => module.createCadastralProvider('offline-test-key').box(smallManualBox, new AbortController().signal), /비활성/);
  assert.equal(manualBoxMocks.calls.length, 0);
});
test('프로덕션에서는 명시적 수동 모드도 차단', async () => {
  resetManual(); const module = await manualModule(false);
  assert.throws(() => module.createCadastralProvider('offline-test-key').box(smallManualBox, new AbortController().signal, 'manual-validation'), /개발 환경/);
  assert.equal(manualBoxMocks.calls.length, 0);
});
test('개발 수동 BOX만 기존 파라미터·domain·파서를 사용해 1회 통과', async () => {
  resetManual(); const module = await manualModule(true);
  const provider = module.createCadastralProvider('offline-test-key', 'https://example.invalid/registered/');
  const result = await provider.box(smallManualBox, new AbortController().signal, 'manual-validation');
  assert.equal(result.completeness, 'complete'); assert.equal(result.features.length, 1);
  const params = manualBoxMocks.calls[0];
  assert.equal(params.get('geomFilter'), 'BOX(126.977,37.566,126.978,37.567)');
  assert.equal(params.get('size'), '1000'); assert.equal(params.get('page'), '1');
  assert.equal(params.get('data'), 'LP_PA_CBND_BUBUN'); assert.equal(params.get('crs'), 'EPSG:4326');
  assert.equal(params.get('key'), 'offline-test-key'); assert.equal(params.get('domain'), 'https://example.invalid/registered/');
  assert.throws(() => provider.box(smallManualBox, new AbortController().signal, 'manual-validation'), /이미 사용/);
  assert.equal(manualBoxMocks.calls.length, 1);
});
test('수동 BOX도 면적 초과·BOX 형식 오류는 전송 0회', async () => {
  resetManual(); const module = await manualModule(true);
  for (const box of [[126, 37, 128, 39], [127, 38, 126, 37], [126, 37, Infinity, 38]]) {
    assert.throws(() => module.createCadastralProvider('offline-test-key').box(box, new AbortController().signal, 'manual-validation'));
  }
  assert.equal(manualBoxMocks.calls.length, 0);
});
test('수동 BOX도 PNU·도형·페이지 응답 검증 유지', async () => {
  resetManual(); const module = await manualModule(true);
  const badPnu = response(); badPnu.response.result.featureCollection.features[0].properties.pnu = 123;
  const badGeometry = response(); badGeometry.response.result.featureCollection.features[0].geometry.type = 'Point';
  const badPage = response({ page: { current: 2, total: 1, size: 1000 } });
  for (const payload of [badPnu, badGeometry, badPage]) {
    manualBoxMocks.payload = payload;
    await assert.rejects(() => module.createCadastralProvider('offline-test-key').box(smallManualBox, new AbortController().signal, 'manual-validation'));
  }
  assert.equal(manualBoxMocks.calls.length, 3); // 가짜 전송 횟수이며 외부 호출은 없다.
});
test('개발 검증 모듈 import는 요청 0회, 명시적 실행은 요약만 반환', async () => {
  resetManual(); const module = await manualModule(true, true); assert.equal(manualBoxMocks.calls.length, 0);
  await assert.rejects(() => module.runManualBoxOnce(smallManualBox, 'wrong'), /명시적 확인/);
  const result = await module.runManualBoxOnce(smallManualBox, 'BOX_MANUAL_ONCE');
  assert.equal(result.pnuFormatValid, true); assert.deepEqual(result.geometryTypes, ['Polygon']);
  assert.equal(result.returnedFeatures, 1); assert.equal('features' in result, false);
  assert.equal('pnu' in result, false); assert.equal('key' in result, false);
  await assert.rejects(() => module.runManualBoxOnce(smallManualBox, 'BOX_MANUAL_ONCE'), /이미 시도/);
  assert.equal(manualBoxMocks.calls.length, 1);
});
test('수동 검증 실패 후 자동·명시적 재시도 없음', async () => {
  resetManual(); manualBoxMocks.failure = true; const module = await manualModule(true, true);
  await assert.rejects(() => module.runManualBoxOnce(smallManualBox, 'BOX_MANUAL_ONCE'));
  await assert.rejects(() => module.runManualBoxOnce(smallManualBox, 'BOX_MANUAL_ONCE'), /이미 시도/);
  assert.equal(manualBoxMocks.calls.length, 1);
});
test('프로덕션에서는 개발 검증 모듈 직접 실행도 차단', async () => {
  resetManual(); const module = await manualModule(false, true);
  await assert.rejects(() => module.runManualBoxOnce(smallManualBox, 'BOX_MANUAL_ONCE'), /개발 환경/);
  assert.equal(manualBoxMocks.calls.length, 0); assert.equal(api.parcelConfig.autoBoundaryQueryEnabled, false);
  assert.equal(api.parcelConfig.maxAreaSquareMeters, 5_000_000);
  assert.equal(api.parcelConfig.maxFeatures, 1000);
});

test('자동 BOX 활성화 조건: 개발·운영 모두 정확한 문자열 true만 허용', async () => {
  for (const [development, value, expected] of [
    [true, 'true', true], [true, undefined, false], [true, 'false', false], [true, 'TRUE', false],
    [true, ' true ', false], [false, 'true', true], [false, undefined, false],
    [false, 'false', false], [false, 'TRUE', false], [false, ' true ', false],
  ]) {
    const module = await bundle(`export { parcelConfig } from './src/config/parcel';`, [], {
      'import.meta.env.DEV': String(development),
      'import.meta.env.VITE_CADASTRAL_AUTO_BOX': value === undefined ? 'undefined' : JSON.stringify(value),
    });
    assert.equal(module.parcelConfig.autoBoundaryQueryEnabled, expected);
  }
});
let developmentTestSequence = 0;
async function developmentModule() {
  return bundle(`export { cadastralFeature } from './src/features/cadastral'; export const instance = ${++developmentTestSequence};`,
    schedulerPlugins, { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': '"true"' });
}
function developmentTest(name, run) {
  test(name, async () => {
    const module = await developmentModule(), fixture = schedulerFixture(module);
    try { await run(fixture); } finally { fixture.finish(); }
  });
}
developmentTest('개발 자동 BOX: 최초 OFF, ON 후 이동·회전·리사이즈마다 필요한 범위 갱신', async (f) => {
  f.fire('moveend'); await f.clock.advance(1000); assert.equal(f.boxes.length, 0);
  assert.equal(f.layers[0].getVisible(), false);
  f.toggle(); await f.clock.advance(350); assert.equal(f.boxes.length, 1);
  f.boxes[0].resolve(batch([feature()])); await tick();
  assert.doesNotMatch(f.boundaryStatus.textContent, /전송 시도|1회 제한/);
  f.fire('movestart'); f.state.center[0] += 30; f.fire('moveend'); await f.clock.advance(2000);
  f.fire('movestart'); f.state.rotation = 0.2; f.fire('moveend'); await f.clock.advance(2000);
  f.state.size = [600, 450]; f.fire('change:size'); await f.clock.advance(2000);
  assert.equal(f.boxes.length, 4);
});
developmentTest('개발 자동 BOX: 실패는 자동 재시도하지 않되 사용자의 OFF/ON은 새 조회 허용', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].reject(new Error('모의 실패')); await tick();
  assert.match(f.boundaryStatus.textContent, /조회하지 못/);
  await f.clock.advance(5000); assert.equal(f.boxes.length, 1);
  f.toggle(); f.toggle(); await f.clock.advance(350);
  assert.equal(f.boxes.length, 2);
});
developmentTest('개발 자동 BOX: 면적 사전 차단 후 작은 범위로 이동하면 조회 허용', async (f) => {
  f.state.size = [3000, 3000]; f.state.resolution = 1; f.toggle(); await f.clock.advance(350);
  assert.equal(f.boxes.length, 0); assert.match(f.boundaryStatus.textContent, /5㎢/);
  f.fire('movestart'); f.state.resolution = 0.1; f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1);
});
developmentTest('개발 자동 BOX: 캐시 재사용은 무전송, TTL 만료 후 필요한 조회 허용', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.fire('movestart'); f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1); assert.equal(f.boundaryStatus.textContent, '');
  await f.clock.advance(60_000); f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 2);
});
developmentTest('개발 자동 BOX: 새 범위 조회 중에도 POINT 선택·상태는 독립', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch()); await tick();
  f.fire('singleclick', click()); f.points[0].resolve(selectionBatch()); await tick();
  const message = f.status.textContent;
  f.fire('movestart'); f.state.center[0] += 10; f.fire('moveend'); await f.clock.advance(2000);
  assert.equal(f.boxes.length, 2); assert.equal(f.panel.hidden, false);
  assert.equal(f.layers[1].getSource().getFeatures().length, 1); assert.equal(f.status.textContent, message);
});
test('개발 자동 BOX는 지도 재마운트 뒤에도 정상 조회 가능', async () => {
  const module = await developmentModule();
  const first = schedulerFixture(module);
  try { first.toggle(); await first.clock.advance(350); assert.equal(first.boxes.length, 1); }
  finally { first.finish(); }
  const second = schedulerFixture(module);
  try {
    second.toggle(); await second.clock.advance(2000);
    assert.equal(second.boxes.length, 1); assert.doesNotMatch(second.boundaryStatus.textContent, /1회 제한/);
  } finally { second.finish(); }
});
developmentTest('개발 자동 BOX: 전송 전 OFF는 예약 취소, 다시 ON 후 정상 조회', async (f) => {
  f.toggle(); await f.clock.advance(349); f.toggle(); await f.clock.advance(2000);
  assert.equal(f.boxes.length, 0); f.toggle(); await f.clock.advance(350); assert.equal(f.boxes.length, 1);
});

developmentTest('ON/OFF: 유효 캐시는 다시 ON 즉시 재표시하고 추가 전송 없음', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature(1), feature(2)])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures().length, 2);
  f.toggle(); assert.equal(f.layers[0].getVisible(), false);
  f.toggle(); assert.equal(f.layers[0].getVisible(), true);
  assert.equal(f.layers[0].getSource().getFeatures().length, 2);
  assert.equal(f.boundaryStatus.textContent, '');
  await f.clock.advance(5000); assert.equal(f.boxes.length, 1); assert.equal(f.layers.length, 2);
});
developmentTest('ON/OFF: 기존 POINT 선택·패널·상태는 숨겼다가 복원', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.fire('singleclick', click()); f.points[0].resolve(selectionBatch()); await tick();
  const message = f.status.textContent;
  f.toggle(); assert.equal(f.panel.hidden, true); assert.equal(f.layers[1].getVisible(), false);
  f.toggle(); assert.equal(f.panel.hidden, false); assert.equal(f.layers[1].getVisible(), true);
  assert.equal(f.layers[1].getSource().getFeatures().length, 1); assert.equal(f.status.textContent, message);
  assert.equal(f.points.length, 1); assert.equal(f.boxes.length, 1); assert.equal(f.layers.length, 2);
});

developmentTest('ON/OFF: 캐시 만료 시 예전 경계를 재표시하지 않고 신규 조회 실행', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.toggle(); await f.clock.advance(60_000); f.toggle(); await f.clock.advance(350);
  assert.equal(f.layers[0].getSource().getFeatures().length, 0); assert.equal(f.boxes.length, 2);
  assert.equal(f.boundaryStatus.textContent, '');
  f.boxes[1].resolve(batch([feature(2)])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures()[0].getId(), '2');
});
developmentTest('ON/OFF: OFF 중 범위 변경은 무전송, 다시 ON하면 새 범위 조회', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.toggle(); f.fire('movestart'); f.state.center[0] += 200; f.fire('moveend');
  await f.clock.advance(2000); assert.equal(f.boxes.length, 1);
  f.toggle(); await f.clock.advance(350);
  assert.equal(f.layers[0].getSource().getFeatures().length, 0); assert.equal(f.boxes.length, 2);
  assert.notDeepEqual(f.boxes[0].args, f.boxes[1].args);
});
developmentTest('ON/OFF: 여러 번 캐시 복원해도 TTL 연장 없음, 만료 후 정상 갱신', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  for (let i = 0; i < 3; i++) {
    f.toggle(); await f.clock.advance(10_000); f.toggle();
    assert.equal(f.layers[0].getSource().getFeatures().length, 1);
  }
  f.toggle(); await f.clock.advance(30_000); f.toggle(); await f.clock.advance(350);
  assert.equal(f.layers[0].getSource().getFeatures().length, 0);
  assert.equal(f.layers.length, 2); assert.equal(f.boxes.length, 2);
});
developmentTest('ON/OFF: POINT 보존 상태에서 닫기는 선택·패널만 정리하고 경계는 유지', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.fire('singleclick', click()); f.points[0].resolve(selectionBatch()); await tick();
  f.toggle(); f.toggle(); f.close();
  assert.equal(f.panel.hidden, true); assert.equal(f.layers[1].getSource().getFeatures().length, 0);
  assert.equal(f.layers[0].getSource().getFeatures().length, 1); assert.equal(f.boxes.length, 1);
});
schedulerTest('ON/OFF: 일반 스케줄러에서 캐시 만료는 기존 조건으로 신규 조회', async (f) => {
  f.toggle(); await f.clock.advance(350); f.boxes[0].resolve(batch([feature()])); await tick();
  f.toggle(); await f.clock.advance(60_000); f.toggle(); await f.clock.advance(350);
  assert.equal(f.boxes.length, 2); assert.equal(f.layers[0].getSource().getFeatures().length, 0);
});

developmentTest('상시 ON/OFF: 다섯 번 다른 범위 조회 가능, 1.5초 간격과 단일 레이어 유지', async (f) => {
  for (let i = 0; i < 5; i++) {
    if (i) { f.state.center[0] += 20; f.fire('moveend'); }
    f.toggle(); await f.clock.advance(2000);
    assert.equal(f.boxes.length, i + 1);
    f.boxes[i].resolve(batch([feature(i)])); await tick();
    assert.equal(f.layers[0].getSource().getFeatures().length, 1);
    f.toggle(); assert.equal(f.layers[0].getVisible(), false);
  }
  for (let i = 1; i < f.boxes.length; i++) assert.ok(f.boxes[i].at - f.boxes[i - 1].at >= 1500);
  assert.equal(f.layers.length, 2); assert.doesNotMatch(f.boundaryStatus.textContent, /전송 시도|1회 제한/);
});
developmentTest('상시 ON/OFF: 취소 불가능한 이전 응답이 새 ON 결과를 덮지 못함', async (f) => {
  f.toggle(); await f.clock.advance(350); const old = f.boxes[0];
  f.toggle(); f.state.center[0] += 20; f.toggle(); await f.clock.advance(1500);
  assert.equal(old.signal.aborted, true); assert.equal(f.boxes.length, 2);
  f.boxes[1].resolve(batch([feature(2)])); await tick(); old.resolve(batch([feature(1)])); await tick();
  assert.equal(f.layers[0].getSource().getFeatures()[0].getId(), '2');
});
developmentTest('상시 ON/OFF: 부분 응답 자동 추가 조회는 없고 명시적 재ON만 새 조회 허용', async (f) => {
  f.toggle(); await f.clock.advance(350);
  f.boxes[0].resolve({ features: [feature()], truncated: true, completeness: 'partial' }); await tick();
  await f.clock.advance(5000); f.fire('moveend'); await f.clock.advance(350);
  assert.equal(f.boxes.length, 1); assert.match(f.boundaryStatus.textContent, /일부/);
  f.toggle(); f.toggle(); await f.clock.advance(350); assert.equal(f.boxes.length, 2);
});
