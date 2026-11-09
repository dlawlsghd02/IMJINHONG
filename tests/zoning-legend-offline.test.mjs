import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// No browser/image transport: src assignments are recorded only.
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ stdin: { contents: `export * from './src/services/vworld/zoningLegend'; export * from './src/ui/zoningLegend'; export * from './src/ui/zoningControls';`,
  resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let assignments = [];
class Element {
  children = []; attributes = new Map(); listeners = new Map(); hidden = false; textContent = '';
  naturalWidth = 160; naturalHeight = 715;
  constructor(tag) { this.tag = tag; }
  append(...nodes) { this.children.push(...nodes); }
  set src(value) { assignments.push(value); }
  setAttribute(k, v) { this.attributes.set(k, v); }
  removeAttribute(k) { this.attributes.delete(k); }
  addEventListener(k, v) { this.listeners.set(k, v); }
  removeEventListener(k) { this.listeners.delete(k); }
  fire(k) { this.listeners.get(k)?.(); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  focus() { document.activeElement = this; }
  remove() {}
}
const media = { matches: true, addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement: (tag) => new Element(tag), activeElement: null };
globalThis.window = { matchMedia: () => media };
const ids = ['lt_c_uq111', 'lt_c_uq112'];

test('범례 URL: 공식 경로·단수 layer/style·인증·선택 domain 및 안전한 검증', () => {
  const url = new URL(api.createZoningLegendUrl(ids[0], 'offline-key', 'https://example.invalid/app/'));
  assert.equal(url.origin + url.pathname, 'https://api.vworld.kr/req/image');
  for (const [key, value] of Object.entries({ service: 'image', version: '2.0', request: 'GetLegendGraphic', layer: ids[0], style: ids[0], type: 'ALL', format: 'png', key: 'offline-key', domain: 'https://example.invalid/app/' })) assert.equal(url.searchParams.get(key), value);
  assert.equal(new URL(api.createZoningLegendUrl(ids[0], 'offline-key')).searchParams.has('domain'), false);
  assert.throws(() => api.createZoningLegendUrl('other', 'offline-key'));
  assert.throws(() => api.createZoningLegendUrl(ids[0], ''));
  assert.throws(() => api.createZoningLegendUrl(ids[0], 'offline-key', 'javascript:invalid'));
});

test('범례: 최초 지연 로드·접기/재펼침·체크/전체 OFF 복원 시 이미지 재사용', () => {
  assignments = [];
  const ui = api.createZoningLegend('offline-key', undefined, () => {});
  const [toggle, panel] = ui.root.children;
  ui.setState(true, ids); assert.equal(assignments.length, 0);
  toggle.fire('click'); assert.equal(assignments.length, 2); assert.equal(panel.hidden, false);
  const sections = panel.children[0].children;
  ui.collapse(); toggle.fire('click'); assert.equal(assignments.length, 2);
  ui.setState(true, [ids[1]]); assert.equal(sections[0].hidden, true);
  ui.setState(false, ids); assert.equal(ui.root.hidden, true);
  ui.setState(true, ids); toggle.fire('click'); assert.equal(assignments.length, 2);
  ui.dispose(); assert.equal(toggle.listeners.size, 0);
  assert.equal(sections[0].children[2].listeners.size, 0);
});

test('범례: 이미지 성공·실패·잘못된 디코딩 상태 및 자동 재시도 없음', () => {
  assignments = [];
  const ui = api.createZoningLegend('offline-key', undefined, () => {});
  ui.setState(true, [ids[0]]); ui.root.children[0].fire('click');
  const [, status, image] = ui.root.children[1].children[0].children[0].children;
  image.fire('load'); assert.equal(image.hidden, false); assert.equal(status.hidden, true);
  image.fire('error'); assert.equal(image.hidden, true); assert.match(status.textContent, /구분/);
  image.naturalWidth = 0; image.fire('load'); assert.equal(status.hidden, false);
  ui.collapse(); ui.root.children[0].fire('click'); assert.equal(assignments.length, 1);
  ui.dispose();
});

test('모바일 통합: 범례와 선택 패널 상호 접기만으로 WMS·투명도 콜백 없음', () => {
  assignments = []; media.matches = true;
  const changes = [], opacities = [];
  const ui = api.createZoningControls((...args) => changes.push(args), (value) => opacities.push(value), { apiKey: 'offline-key' });
  const [toggle, options, , legend] = ui.root.children;
  toggle.fire('click'); assert.equal(changes.length, 1);
  legend.children[0].fire('click'); assert.equal(options.hidden, true); assert.equal(changes.length, 1);
  toggle.fire('click'); assert.equal(options.hidden, false); assert.equal(legend.children[1].hidden, true);
  assert.equal(changes.length, 1); assert.equal(opacities.length, 0);
  ui.dispose();
});
