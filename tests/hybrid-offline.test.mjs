import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ stdin: { contents: `export * from './src/map/basemaps'; export * from './src/services/vworld/tileUrl'; export * from './src/ui/mapControls';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('Hybrid URL: PNG·기존 z/y/x 인증 경로', () => {
  assert.equal(api.createTileUrl('hybrid', 'offline-key'), 'https://api.vworld.kr/req/wmts/1.0.0/offline-key/Hybrid/{z}/{y}/{x}.png');
});
test('일반·위성 전환과 명칭 상태 독립, 기본 ON 및 마지막 설정 보존', () => {
  const maps = api.createBasemaps('offline-key', () => {});
  const [base, satellite, hybrid] = maps.layers;
  assert.deepEqual(maps.layers.map((v) => v.getVisible()), [true, false, false]);
  assert.equal(hybrid.getZIndex(), 30); assert.equal(hybrid.getSource().getProjection().getCode(), 'EPSG:3857');
  maps.select('satellite'); assert.equal(satellite.getVisible(), true); assert.equal(hybrid.getVisible(), true);
  maps.setNamesEnabled(false); assert.equal(satellite.getVisible(), true); assert.equal(hybrid.getVisible(), false);
  maps.select('base'); maps.select('satellite'); assert.equal(hybrid.getVisible(), false);
  maps.setNamesEnabled(true); maps.select('base'); assert.equal(base.getVisible(), true); assert.equal(hybrid.getVisible(), false);
  maps.select('satellite'); assert.equal(hybrid.getVisible(), true); maps.dispose();
});
test('명칭 실패는 위성영상과 독립, OFF 숨김, 기존 재요청은 위성 소스만', () => {
  const failures = [], statuses = [];
  const maps = api.createBasemaps('offline-key', (v) => statuses.push(v), (n) => failures.push(n));
  maps.select('satellite');
  const satellite = maps.layers[1], hybrid = maps.layers[2];
  hybrid.getSource().dispatchEvent('tileloaderror');
  assert.equal(failures.at(-1), 1); assert.equal(satellite.getVisible(), true);
  assert.equal(statuses.at(-1).failures, 0);
  maps.setNamesEnabled(false); assert.equal(failures.at(-1), 0);
  const revision = hybrid.getSource().getRevision(); maps.retry(); assert.equal(hybrid.getSource().getRevision(), revision);
  maps.setNamesEnabled(true); assert.equal(failures.at(-1), 1);
  maps.dispose(); assert.equal(hybrid.getSource().hasListener('tileloaderror'), false);
});
test('명칭 UI: 위성에서만 표시, aria 상태 및 전환 후 선택값 유지', () => {
  const make = (dataset) => ({ dataset, disabled: true, hidden: false, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } });
  const base = make({ basemap: 'base' }), satellite = make({ basemap: 'satellite' }), names = make({}); names.hidden = true;
  const buttons = [base, satellite, names]; let click;
  const host = { querySelector: () => names, querySelectorAll: (selector) => selector === '[data-basemap]' ? [base, satellite] : buttons,
    addEventListener: (_, callback) => { click = callback; } };
  const changes = [], selections = [];
  const dispose = api.bindMapControls(host, {}, (id) => selections.push(id), (value) => changes.push(value));
  const fire = (button) => click({ target: { closest: () => button } });
  fire(satellite); assert.equal(names.hidden, false);
  assert.equal(base.attributes['aria-pressed'],'false'); assert.equal(satellite.attributes['aria-pressed'],'true');
  fire(names); assert.deepEqual(changes, [false]); assert.equal(names.attributes['aria-pressed'], 'false');
  fire(base); assert.equal(names.hidden, true);
  assert.equal(base.attributes['aria-pressed'],'true'); assert.equal(satellite.attributes['aria-pressed'],'false');
  fire(satellite);
  assert.equal(names.attributes['aria-pressed'], 'false'); assert.deepEqual(changes, [false]);
  assert.deepEqual(selections, ['satellite', 'base', 'satellite']); dispose(); assert.equal(names.disabled, true);
});
