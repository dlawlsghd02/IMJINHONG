import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// No browser/image transport: src assignments are recorded only.
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ stdin: { contents: `export * from './src/services/vworld/zoningLegend'; export * from './src/ui/zoningLegend'; export * from './src/ui/zoningControls'; export * from './src/ui/zoningLegendNames';`,
  resolveDir: root, loader: 'ts' }, loader: { '.png': 'dataurl' }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
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

test('범례 명칭: 9개 표시 순서·코드 대응 유지 및 규제정보 의존성 없음', async () => {
  assert.deepEqual(api.majorLegendNames, {
    lt_c_uq111: ['주거지역', '상업지역', '공업지역', '녹지지역'],
    lt_c_uq112: ['보전관리지역', '생산관리지역', '계획관리지역'],
    lt_c_uq113: ['농림지역'], lt_c_uq114: ['자연환경보전지역'],
  });
  assert.deepEqual(api.zoningLegendCodeNames, {
    UQB300: '보전관리지역', UQB200: '생산관리지역', UQB100: '계획관리지역',
    UQC001: '농림지역', UQD001: '자연환경보전지역',
  });
  for (const file of ['zoningLegend.ts', 'zoningLegendNames.ts']) {
    const source = await readFile(new URL('../src/ui/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /regulationDictionary/);
  }
  assert.ok(!Object.keys(result.metafile.inputs).some((path) => /regulationDictionary/.test(path)));
});

test('주요 범례: 캡처 견본 9개의 출처·해시·원본 크기 보존', async () => {
  const base = new URL('../src/assets/zoning-swatches/', import.meta.url);
  const metadata = JSON.parse(await readFile(new URL('provenance.json', base), 'utf8'));
  assert.equal(metadata.assets.length, 9);
  for (const entry of metadata.assets) {
    const bytes = await readFile(new URL(entry.asset, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), entry.cropBoxes.length * 14);
    assert.equal(bytes.readUInt32BE(20), 14);
    const original = await readFile(new URL('../' + entry.source, import.meta.url));
    assert.equal(createHash('sha256').update(original).digest('hex'), entry.sourceSha256);
    assert.ok(entry.cropBoxes.every(([left, top, right, bottom]) => right - left === 14 && bottom - top === 14));
  }
});

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
  toggle.fire('click'); assert.equal(assignments.length, 0); assert.equal(panel.hidden, false);
  const sections = panel.children[0].children;
  assert.ok(sections.every((section) => section.children[1].hidden));
  const group = (index) => sections[index].children[0].children[0];
  assert.equal(group(0).attributes.get('aria-controls'), sections[0].children[1].id);
  assert.equal(sections[0].children[1].attributes.get('aria-labelledby'), group(0).id);
  group(0).fire('click'); assert.equal(assignments.length, 1);
  assert.equal(sections[0].children[1].hidden, false);
  document.activeElement = sections[0].children[1].children[1];
  group(1).fire('click'); assert.equal(assignments.length, 2);
  assert.equal(document.activeElement, group(0));
  assert.equal(sections[0].children[1].hidden, true);
  assert.equal(group(0).attributes.get('aria-expanded'), 'false');
  assert.equal(group(1).attributes.get('aria-expanded'), 'true');
  group(1).fire('click'); assert.equal(sections[1].children[1].hidden, true);
  group(0).fire('click'); assert.equal(assignments.length, 2);
  ui.collapse(); toggle.fire('click'); assert.equal(assignments.length, 2);
  ui.setState(true, [ids[1]]); assert.equal(sections[0].hidden, true);
  ui.setState(false, ids); assert.equal(ui.root.hidden, true);
  ui.setState(true, ids); toggle.fire('click'); assert.equal(assignments.length, 2);
  ui.dispose(); assert.equal(toggle.listeners.size, 0);
  assert.equal(sections[0].children[1].children[1].listeners.size, 0);
  assert.equal(group(0).listeners.size, 0);
  document.activeElement = null;
});

test('범례: 이미지 성공·실패·잘못된 디코딩 상태 및 자동 재시도 없음', () => {
  assignments = [];
  const ui = api.createZoningLegend('offline-key', undefined, () => {});
  ui.setState(true, [ids[0]]); ui.root.children[0].fire('click');
  const section = ui.root.children[1].children[0].children[0];
  section.children[0].children[0].fire('click');
  const [status, image] = section.children[1].children;
  image.fire('load'); assert.equal(image.hidden, false); assert.equal(status.hidden, true);
  image.fire('error'); assert.equal(image.hidden, true); assert.match(status.textContent, /구분/);
  image.naturalWidth = 0; image.fire('load'); assert.equal(status.hidden, false);
  ui.collapse(); ui.root.children[0].fire('click'); assert.equal(assignments.length, 1);
  ui.dispose();
});

test('통합 패널: 체크박스·그룹 범례·전체 세부 범례 독립과 이미지 재사용', async () => {
  assignments = []; media.matches = true;
  const changes = [], opacities = [];
  const ui = api.createZoningControls((...args) => changes.push(args), (value) => opacities.push(value), { apiKey: 'offline-key' });
  const [toggle, options] = ui.root.children;
  toggle.fire('click'); assert.equal(changes.length, 1);
  assert.equal(ui.root.children.length, 3);
  const rows = options.children.filter((node) => node.className === 'zoning-group-row');
  const groups = options.children.filter((node) => node.className === 'zoning-group-body');
  assert.deepEqual(rows.map((row) => row.children[0].children[1].textContent), ['도시지역', '관리지역', '농림지역', '자연환경보전지역']);
  assert.ok(groups.every((section) => section.hidden));
  rows[0].children[1].fire('click'); assert.equal(options.hidden, false);
  assert.equal(groups[0].hidden, false); assert.equal(assignments.length, 0);
  assert.deepEqual(groups.map((group) => group.children[0].children.map((item) => item.children[0].textContent)), [
    ['주거지역','상업지역','공업지역','녹지지역'],
    ['보전관리지역','생산관리지역','계획관리지역'], ['농림지역'], ['자연환경보전지역'],
  ]);
  assert.equal(groups[0].children[0].attributes.get('aria-label'), '주요 용도지역');
  assert.equal(groups[0].children[1].textContent, '제공된 범례 캡처 견본 · 원본 SLD 색상값 미검증');
  const expectedAssets = ['urban-residential','urban-commercial','urban-industrial','urban-green',
    'management-conservation','management-production','management-planned','agriculture-forest','nature-conservation'];
  const actualSwatches = groups.flatMap((group) => group.children[0].children.map((item) => item.children[1].attributes.get('src')));
  for (const [index, name] of expectedAssets.entries()) {
    const bytes = await readFile(new URL('../src/assets/zoning-swatches/' + name + '.png', import.meta.url));
    assert.equal(actualSwatches[index], `data:image/png;base64,${bytes.toString('base64')}`);
  }
  for (const group of groups) for (const item of group.children[0].children) {
    const swatches = item.children[1];
    assert.equal(swatches.className, 'zoning-major-swatches');
    assert.match(swatches.attributes.get('src'), /^data:image\/png;base64,/);
    assert.match(swatches.alt, /세부 색상·패턴 견본/);
  }
  assert.ok(groups.every((group) => group.children[0].children.every((item) => !item.style)));
  const [ , , details, body] = groups[0].children;
  assert.equal(details.className, 'zoning-details-toggle');
  details.fire('click'); assert.equal(assignments.length, 1);
  assert.equal(groups[0].children[0].hidden, false);
  const [status, image] = body.children;
  image.fire('load'); assert.equal(image.hidden, false); assert.equal(status.hidden, true);
  details.fire('click'); details.fire('click'); assert.equal(assignments.length, 1);
  rows[1].children[1].fire('click');
  assert.equal(groups[0].hidden, true); assert.equal(body.hidden, true);
  assert.equal(details.attributes.get('aria-expanded'), 'false');
  assert.equal(groups[1].hidden, false);
  assert.equal(changes.length, 1); assert.equal(opacities.length, 0);
  const input = rows[0].children[0].children[0]; input.checked = false; input.fire('change');
  assert.equal(changes.length, 2); assert.deepEqual(changes.at(-1)[1], ['lt_c_uq112','lt_c_uq113','lt_c_uq114']);
  assert.equal(groups[1].hidden, false); assert.equal(assignments.length, 1);
  toggle.fire('click'); assert.equal(options.hidden, true); assert.ok(groups.every((section) => section.hidden));
  ui.dispose();
});
