import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
async function bundle(contents, plugins = []) {
  const result = await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, loader: { '.png': 'dataurl' }, bundle: true, platform: 'node', format: 'esm', write: false, plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const api = await bundle(`export * from './src/services/vworld/zoningWms'; export { createZoningControls } from './src/ui/zoningControls';`);
class Element {
  children = []; attributes = new Map(); listeners = new Map(); textContent = ''; hidden = false; removed = false;
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
  remove() { this.removed = true; }
  fire(type) { this.listeners.get(type)?.(); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  focus() { document.activeElement = this; }
}
globalThis.document = { createElement: () => new Element(), activeElement: null };
const media = { matches: false, listeners: new Set(),
  addEventListener(type, fn) { this.listeners.add(fn); },
  removeEventListener(type, fn) { this.listeners.delete(fn); },
  change(value) { this.matches = value; for (const fn of this.listeners) fn({ matches: value }); },
};
globalThis.window = { matchMedia: () => media };
const kindLabels = (options) => options.children.filter((node) => node.className === 'zoning-group-row').map((row) => row.children[0]);

test('WMS: 검증된 네 레이어와 스타일을 같은 순서로 구성', () => {
  assert.deepEqual(api.zoningLayers.map((v) => v.id), ['lt_c_uq111', 'lt_c_uq112', 'lt_c_uq113', 'lt_c_uq114']);
  assert.deepEqual(api.zoningParameters(['lt_c_uq111', 'lt_c_uq114']), { LAYERS: 'lt_c_uq111,lt_c_uq114', STYLES: 'lt_c_uq111,lt_c_uq114' });
  assert.throws(() => api.zoningParameters(['other'])); assert.throws(() => api.zoningParameters(['lt_c_uq111', 'lt_c_uq111']));
});
test('WMS: 공식 경로·버전·PNG·CRS·인증 설정, 익명 CORS 미적용', () => {
  const source = api.createZoningSource('offline-key', 'https://example.invalid/app/');
  assert.deepEqual(source.getUrls(), ['https://api.vworld.kr/req/wms']);
  const p = source.getParams(); assert.equal(p.VERSION, '1.3.0'); assert.equal(p.FORMAT, 'image/png'); assert.equal(p.KEY, 'offline-key'); assert.equal(p.DOMAIN, 'https://example.invalid/app/');
  assert.equal(source.getProjection().getCode(), 'EPSG:3857'); assert.equal(source.crossOrigin, null);
  // URL만 생성하며 실제 이미지를 로드하지 않는다.
  const url = new URL(source.getTileUrlFunction()([16, 55883, 25379], 1, source.getProjection()));
  assert.equal(url.searchParams.get('CRS'), 'EPSG:3857'); assert.equal(url.searchParams.get('REQUEST'), 'GetMap'); assert.equal(url.searchParams.get('TRANSPARENT'), 'true');
  source.dispose();
});
test('WMS: 설정 오류는 안전한 고정 메시지, domain 생략 허용', () => {
  assert.throws(() => api.createZoningSource(''), /인증 설정/);
  assert.throws(() => api.createZoningSource('offline-key', 'javascript:invalid'), /domain 설정/);
  const source = api.createZoningSource('offline-key'); assert.equal(source.getParams().DOMAIN, undefined); source.dispose();
});
test('UI: 최초 OFF·전체 분류 선택·개별 해제·투명도·이벤트 정리', () => {
  const changes = [], opacities = [];
  const ui = api.createZoningControls((...args) => changes.push(args), (v) => opacities.push(v));
  const [toggle, options, status] = ui.root.children;
  assert.equal(changes.length, 0); assert.equal(options.hidden, true); assert.equal(toggle.attributes.get('aria-pressed'), 'false');
  toggle.fire('click'); assert.equal(options.hidden, false); assert.equal(changes[0][1].length, 4);
  const input = kindLabels(options)[0].children[0]; input.checked = false; input.fire('change'); assert.equal(changes.at(-1)[1].length, 3);
  const range = options.children.at(-1).children[1]; range.value = '35'; range.fire('input'); assert.deepEqual(opacities, [0.35]);
  range.value = 'invalid'; range.fire('input'); assert.equal(opacities.length, 1);
  ui.setStatus('읽는 중', true); assert.equal(status.attributes.get('aria-busy'), 'true');
  toggle.fire('click'); assert.equal(changes.at(-1)[0], false); ui.dispose(); assert.equal(toggle.listeners.size, 0); assert.equal(range.listeners.size, 0);
});

const instances = [];
const feature = await bundle(`export { zoningFeature } from './src/features/zoning';`, [{ name: 'offline-source', setup(b) {
  b.onLoad({ filter: /[/\\]services[/\\]vworld[/\\]zoningWms\.ts$/ }, () => ({ loader: 'ts', resolveDir: root, contents: `
    import XYZ from 'ol/source/XYZ.js';
    export const zoningLayers = ['lt_c_uq111','lt_c_uq112','lt_c_uq113','lt_c_uq114'].map(id=>({id,label:id}));
    export const zoningParameters = ids => ({LAYERS:ids.join(','),STYLES:ids.join(',')});
    export function createZoningSource() { const s=new XYZ(); s.setKey('offline'); s.updateParams=p=>s.setKey('offline-'+p.LAYERS); globalThis.zoningSources.push(s); return s; }
  ` }));
} }]);
globalThis.zoningSources = instances;
function fixture() {
  const layers = [], host = new Element();
  const map = { addLayer: (v) => layers.push(v), removeLayer: (v) => layers.splice(layers.indexOf(v), 1) };
  const dispose = feature.zoningFeature.mount({ map, zoningHost: host, vworldApiKey: 'offline-key' });
  const source = instances.at(-1), layer = layers[0], [toggle, options, status] = host.children[0].children;
  return { dispose, source, layer, layers, toggle, options, status };
}
test('레이어: 최초 비표시·순서20·전체 해제 시 숨김·OFF·해제 시 제거', () => {
  const f = fixture(); assert.equal(f.layer.getVisible(), false); assert.equal(f.layer.getZIndex(), 20); assert.equal(f.layer.getOpacity(), 0.55);
  f.toggle.fire('click'); assert.equal(f.layer.getVisible(), true);
  for (const label of kindLabels(f.options)) { label.children[0].checked = false; label.children[0].fire('change'); }
  assert.equal(f.layer.getVisible(), false); assert.match(f.status.textContent, /선택/);
  f.toggle.fire('click'); assert.equal(f.status.hidden, true); f.dispose(); assert.equal(f.layers.length, 0);
});
test('상태: 로딩·실패 고정 안내·이전 설정 타일 무시·OFF 및 해제 후 무반응', () => {
  const f = fixture(); f.toggle.fire('click');
  const tile = { getKey: () => f.source.getKey() + '/1,2,3' };
  f.source.dispatchEvent({ type: 'tileloadstart', tile }); assert.equal(f.status.attributes.get('aria-busy'), 'true');
  f.source.dispatchEvent({ type: 'tileloaderror', tile }); assert.match(f.status.textContent, /1건 실패/);
  const old = { getKey: () => 'old/1,2,3' }; f.source.dispatchEvent({ type: 'tileloaderror', tile: old }); assert.match(f.status.textContent, /1건 실패/);
  f.toggle.fire('click'); f.source.dispatchEvent({ type: 'tileloaderror', tile }); assert.equal(f.status.hidden, true);
  f.dispose(); assert.equal(f.source.hasListener('tileloadstart'), false);
});

test('정상 상태 안내 미표시: 초기 ON·로딩·완료는 숨기고 오류만 표시, busy 상태 유지',()=>{
  media.change(false);
  const f=fixture();
  try {
    f.toggle.fire('click'); assert.equal(f.status.textContent,''); assert.equal(f.status.hidden,true);
    const tile={getKey:()=>f.source.getKey()+'/1,2,3'};
    f.source.dispatchEvent({type:'tileloadstart',tile});
    assert.equal(f.status.textContent,''); assert.equal(f.status.hidden,true);
    assert.equal(f.status.attributes.get('aria-busy'),'true');
    f.source.dispatchEvent({type:'tileloadend',tile});
    assert.equal(f.status.hidden,true); assert.equal(f.status.attributes.get('aria-busy'),'false');
    f.source.dispatchEvent({type:'tileloaderror',tile});
    assert.equal(f.status.hidden,false); assert.match(f.status.textContent,/1건 실패/);
    f.toggle.fire('click'); assert.equal(f.status.hidden,true);
  } finally {f.dispose();}
});

test('UI 상태 구분: 레이어 ON과 모바일 설정 접힘은 별도 표기하며 네 분류 유지',()=>{
  media.change(true);
  const calls=[],ui=api.createZoningControls((...args)=>calls.push(args),()=>{});
  try {
    const [button,options]=ui.root.children;
    assert.equal(ui.root.attributes.get('data-enabled'),'false');
    button.fire('click');
    assert.equal(ui.root.attributes.get('data-enabled'),'true');
    assert.match(button.attributes.get('aria-label'),/켜짐.*펼쳐짐/);
    const count=calls.length; button.fire('click');
    assert.equal(button.attributes.get('aria-pressed'),'true');
    assert.equal(button.attributes.get('aria-expanded'),'false');
    assert.match(button.attributes.get('aria-label'),/켜짐.*접힘/);
    assert.equal(calls.length,count); assert.equal(kindLabels(options).length,4);
  } finally {ui.dispose();media.change(false);}
});
test('기존 클릭 보호: WMS에는 지도 클릭 등록·속성·BOX 호출이 없음', async () => {
  const code = await readFile(new URL('../src/features/zoning.ts', import.meta.url), 'utf8');
  assert.equal(/singleclick|provider\.point|provider\.box|loadLand/.test(code), false);
});
test('초기화 오류: 추가한 레이어 제거 후 오류를 호출자에게 전달', () => {
  const layers = [], map = { addLayer: (v) => layers.push(v), removeLayer: (v) => layers.splice(layers.indexOf(v), 1) };
  assert.throws(() => feature.zoningFeature.mount({ map, zoningHost: { append() { throw new Error('offline-host-error'); } }, vworldApiKey: 'offline-key' }), /offline-host-error/);
  assert.equal(layers.length, 0); assert.equal(instances.at(-1).hasListener('tileloaderror'), false);
});

test('모바일: 최초 ON·펼침, 접기·재펼침은 무콜백, 전체 스위치와 선택·불투명도 보존', () => {
  media.change(true);
  const changes = [], opacities = [], ui = api.createZoningControls((...v) => changes.push(v), (v) => opacities.push(v));
  try {
    const [button, options] = ui.root.children;
    assert.equal(changes.length, 0); assert.equal(button.attributes.get('aria-expanded'), 'false');
    button.fire('click'); assert.equal(changes.length, 1); assert.equal(changes[0][0], true); assert.equal(options.hidden, false);
    const input = kindLabels(options)[0].children[0]; input.checked = false; input.fire('change');
    const slider = options.children.at(-1).children[1]; slider.value = '35'; slider.fire('input');
    const calls = changes.length;
    document.activeElement = slider; button.fire('click');
    assert.equal(options.hidden, true); assert.equal(button.attributes.get('aria-pressed'), 'true'); assert.equal(changes.length, calls); assert.equal(document.activeElement, button);
    button.fire('click'); assert.equal(options.hidden, false); assert.equal(changes.length, calls);
    const switchInput = options.children.find((n) => n.className === 'zoning-visibility').children[0];
    switchInput.checked = false; switchInput.fire('change'); assert.equal(changes.at(-1)[0], false);
    switchInput.checked = true; switchInput.fire('change'); assert.equal(changes.at(-1)[0], true);
    assert.equal(input.checked, false); assert.equal(changes.at(-1)[1].length, 3); assert.equal(slider.value, '35'); assert.deepEqual(opacities, [0.35]);
    assert.equal(button.attributes.get('aria-expanded'), 'true');
  } finally { ui.dispose(); media.change(false); document.activeElement = null; }
  assert.equal(media.listeners.size, 0);
});

test('화면 전환: enabled·expanded 유지와 무콜백, PC 버튼은 기존 OFF·ON', () => {
  media.change(true); const calls = []; const ui = api.createZoningControls((...v) => calls.push(v), () => {});
  try {
    const [button, options] = ui.root.children;
    button.fire('click'); button.fire('click'); assert.equal(options.hidden, true);
    const count = calls.length;
    media.change(false); media.change(true); media.change(true);
    assert.equal(calls.length, count); assert.equal(options.hidden, true); assert.equal(button.attributes.get('aria-pressed'), 'true');
    media.change(false); button.fire('click'); assert.equal(calls.at(-1)[0], false); assert.equal(options.hidden, true);
    button.fire('click'); assert.equal(calls.at(-1)[0], true); assert.equal(options.hidden, false);
  } finally { ui.dispose(); media.change(false); }
});

test('모바일 레이어: 패널 접기는 source 설정 갱신 없이 visible 유지, 전체 OFF는 숨김', () => {
  media.change(true); const f = fixture();
  try {
    let updates = 0; const original = f.source.updateParams;
    f.source.updateParams = (params) => { updates++; original(params); };
    f.toggle.fire('click'); assert.equal(updates, 1); assert.equal(f.layer.getVisible(), true);
    f.toggle.fire('click'); assert.equal(updates, 1); assert.equal(f.layer.getVisible(), true);
    f.toggle.fire('click'); assert.equal(updates, 1);
    const input = f.options.children.find((n) => n.className === 'zoning-visibility').children[0];
    input.checked = false; input.fire('change'); assert.equal(f.layer.getVisible(), false);
    const count = updates; media.change(false); media.change(true); assert.equal(updates, count);
  } finally { f.dispose(); media.change(false); }
});

test('모바일 CSS·오류 분류: 2열·전체 너비·줄바꿈·스크롤·44px·오류 예외 유지', async () => {
  const read = (p) => readFile(new URL('../' + p, import.meta.url), 'utf8');
  const [zoning, parcel, map, main, layout, controls] = await Promise.all(['src/styles/zoning.css','src/styles/parcel.css','src/styles/map.css','src/main.ts','src/ui/layout.ts','src/ui/mapControls.ts'].map(read));
  assert.match(zoning, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(zoning, /zoning-opacity\s*\{[^}]*grid-column: 1 \/ -1/);
  assert.match(zoning, /overflow-wrap: anywhere/); assert.match(zoning, /overflow: auto/); assert.match(zoning, /24dvh/);
  assert.match(zoning, /max-width: 280px/);
  assert.match(zoning, /max-height: 35dvh/);
  assert.match(zoning, /max-height: 30dvh/);
  assert.match(zoning, /overscroll-behavior: contain/);
  assert.match(zoning, /fieldset\s*\{ display: block/);
  assert.match(zoning, /zoning-group-row\s*\{ display: flex/);
  assert.match(zoning, /zoning-details-toggle\s*\{[^}]*min-height: 28px;[^}]*padding: 3px 6px/);
  assert.match(zoning, /zoning-details-toggle\s*\{[^}]*min-height: 44px;[^}]*background-clip: padding-box/);
  assert.match(zoning, /pointer: coarse/);
  assert.match(zoning, /zoning-legend-panel\s*\{[^}]*max-height: none; overflow: visible/);
  assert.match(zoning, /fieldset\s*\{[^}]*max-height: none; overflow: visible/);
  for (const css of [zoning, parcel, map]) assert.match(css, /min-height: 44px/);
  assert.match(map, /data-state="normal".*:not\(:has\(\.feature-init-warning\)\)/);
  assert.match(main, /failures \? 'error' : 'normal'/); assert.match(main, /ui.status.dataset.state = 'error'/); assert.match(main, /notice.className = 'feature-init-warning'/);
  assert.match(map, /\.ol-attribution/); assert.doesNotMatch(map, /\.ol-attribution\s*\{[^}]*display:\s*none/);
  assert.match(layout, /data-zoom="1"/); assert.match(layout, /data-zoom="-1"/); assert.match(controls, /view.animate/);
});
