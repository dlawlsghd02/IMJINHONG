import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
globalThis.attributeProbeMocks = { calls: [], payload: null, failure: null, pending: null };
async function load(dev, mock = false) {
  const result = await build({ stdin: { contents: "export * from './src/dev/attributeProbe'; export * from './src/services/vworld/sandboxJsonp'; export * from './src/services/vworld/cadastralJsonp'; export { loadLandLedger } from './src/services/vworld/landLedger'; export { loadLandPrice, loadLandPricePage } from './src/services/vworld/landPrice';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
    define: { 'import.meta.env.DEV': String(dev), 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': 'undefined',
      'import.meta.env.VITE_VWORLD_API_KEY': JSON.stringify('offline-test-key'),
      'import.meta.env.VITE_VWORLD_DOMAIN': JSON.stringify('https://example.invalid/registered/') },
    plugins: mock ? [{ name: 'offline-attribute-transport', setup(b) {
      b.onResolve({ filter: /sandboxJsonp$/ }, (args) => /(?:attributeProbe|attributeRequest)\.ts$/.test(args.importer) ? { path: 'attribute-mock', namespace: 'offline' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: `export async function requestSandboxJsonp(service, parameters, signal) {
        const m = globalThis.attributeProbeMocks; m.calls.push({service, parameters, signal});
        if (m.failure) throw m.failure;
        if (m.pending) return await m.pending;
        return m.payload;
      }`, loader: 'js' }));
    } }] : [] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const api = await load(true);
const id = '1114010300100310000';
test('PNU 및 사용자 연도 입력 검사', async () => {
  assert.match((await api.runAttributeProbe('ledger', '123', '')).message, /19자리/);
  assert.match((await api.runAttributeProbe('price', id, '')).message, /네 자리/);
});
test('프로덕션 직접 실행도 요청 전에 차단', async () => {
  const prod = await load(false);
  assert.match((await prod.runAttributeProbe('ledger', id, '')).message, /개발 환경/);
});
const ledger = { ladfrlVOList: { totalCount: '1', resultCode: '00', field: [{ pnu: id, lndcgrCode: '08', lndcgrCodeNm: '대', lndpclAr: '100.5', lastUpdtDt: '2026-01-02', secret: 'DO_NOT_SHOW' }] } };
test('버튼 경로: import 무전송, 서비스별 독립 파라미터와 전송 각 1회', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = ledger;
  const module = await load(true, true); assert.equal(m.calls.length, 0);
  const result = await module.runAttributeProbe('ledger', id, '');
  assert.equal(result.state, 'success'); assert.equal(result.executed, true); assert.equal(result.transport, 'sandbox JSONP');
  m.payload = { indvdLandPrices: { totalCount: '1', field: [{ pnu: id, stdrYear: '2025', stdrMt: '01', pblntfPclnd: '10000' }] } };
  assert.equal((await module.runAttributeProbe('price', id, '2025')).state, 'success');
  assert.equal(m.calls.length, 2);
  for (const { parameters } of m.calls) {
    assert.equal(parameters.get('key'), 'offline-test-key'); assert.equal(parameters.get('domain'), 'https://example.invalid/registered/');
    assert.equal(parameters.get('pnu'), id); assert.equal(parameters.get('format'), 'json'); assert.equal(parameters.get('numOfRows'), '10'); assert.equal(parameters.get('pageNo'), '1');
    for (const name of ['service', 'request', 'geomFilter', 'data', 'size', 'crs']) assert.equal(parameters.has(name), false);
  }
  assert.equal(m.calls[0].parameters.has('stdrYear'), false); assert.equal(m.calls[1].parameters.get('stdrYear'), '2025');
});
test('진행 중 중복 억제, 서비스 독립성과 실패 자동 재시도 없음', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = [];
  const module = await load(true, true);
  let resolve; m.pending = new Promise((r) => { resolve = r; });
  const first = module.runAttributeProbe('ledger', id, '');
  assert.equal((await module.runAttributeProbe('ledger', id, '')).state, 'blocked');
  const second = module.runAttributeProbe('price', id, '2025');
  assert.equal(m.calls.length, 2); resolve(ledger); await first; await second; m.pending = null;
  m.calls = []; m.failure = new Error('offline-test-key https://secret.invalid/?key=SECRET');
  const result = await module.runAttributeProbe('ledger', id, '');
  assert.equal(result.diagnostic, 'ATTRIBUTE_TRANSPORT'); assert.equal(m.calls.length, 1);
  assert.equal(JSON.stringify(result).includes('secret.invalid'), false); m.failure = null;
});
test('인증·일반 API·형식 오류와 모호한 빈 응답 분리', () => {
  assert.equal(api.summarizeAttributeResponse('ledger', { response: { status: 'ERROR', error: { code: 'INCORRECT_KEY', text: 'SECRET' } } }, id, '').diagnostic, 'ATTRIBUTE_AUTH');
  assert.equal(api.summarizeAttributeResponse('ledger', { ladfrlVOList: { resultCode: 'OVER_REQUEST_LIMIT' } }, id, '').diagnostic, 'ATTRIBUTE_API');
  assert.equal(api.summarizeAttributeResponse('ledger', { ladfrlVOList: {} }, id, '').diagnostic, 'ATTRIBUTE_RESPONSE_INVALID');
});
test('기존 토지임야 파서 재사용과 안전한 허용 필드 요약', () => {
  const result = api.summarizeAttributeResponse('ledger', ledger, id, '');
  assert.equal(result.state, 'success'); assert.equal(result.area, 100.5); assert.equal(result.pnuMatches, true);
  assert.equal(result.fields.includes('secret'), false); assert.equal(JSON.stringify(result).includes('DO_NOT_SHOW'), false);
  assert.match(result.transport, /모의/);
});
test('실제 반환 연도·공시일과 가격 요약', () => {
  const payload = { indvdLandPrices: { totalCount: '1', field: [{ pnu: id, stdrYear: '2025', stdrMt: '01', pblntfPclnd: '10000', pblntfDe: '2025-04-30' }] } };
  const result = api.summarizeAttributeResponse('price', payload, id, '2025');
  assert.equal(result.state, 'success'); assert.equal(result.year, '2025'); assert.equal(result.price, 10000); assert.equal(result.date, '2025-04-30');
  assert.equal(api.summarizeAttributeResponse('price', payload, id, '2026').state, 'failed');
});
test('정상 빈 응답과 오류·PNU 불일치 구분', () => {
  assert.equal(api.summarizeAttributeResponse('ledger', { ladfrlVOList: { totalCount: '0', field: [] } }, id, '').state, 'not-found');
  assert.equal(api.summarizeAttributeResponse('ledger', ledger, '1114010300100310001', '').state, 'failed');
  const result = api.summarizeAttributeResponse('ledger', { ladfrlVOList: { resultCode: 'SECRET_CODE', resultMsg: 'DO_NOT_SHOW' } }, id, '');
  assert.equal(result.state, 'failed'); assert.equal(JSON.stringify(result).includes('SECRET_CODE'), false); assert.equal(JSON.stringify(result).includes('DO_NOT_SHOW'), false);
});

function priceResponse(overrides = {}) {
  return { indvdLandPrices: { totalCount: '1', numOfRows: '10', pageNo: '1', field: [{ pnu: id, stdrYear: '2025', stdrMt: '01', pblntfPclnd: '10000', pblntfDe: '2025-04-30', lastUpdtDt: '2025-05-01', ...overrides }] } };
}
for (const [field, value, stage] of [
  ['pnu', '1114010300100310001', 'pnu'], ['pnu', 123, 'pnu'],
  ['stdrYear', '2024', 'year'], ['stdrYear', 2025, 'year'],
  ['stdrMt', '1', 'month'], ['stdrMt', 1, 'month'],
  ['pblntfPclnd', '10,000', 'price'], ['pblntfPclnd', -1, 'price'],
  ['pblntfDe', '20250430', 'published-date'], ['lastUpdtDt', '2025-02-30', 'updated-date'],
]) {
  test(`공시지가 실패 단계: ${field} (${typeof value}) → ${stage}`, () => {
    const result = api.summarizeAttributeResponse('price', priceResponse({ [field]: value }), id, '2025');
    assert.equal(result.diagnostic, 'ATTRIBUTE_RESPONSE_INVALID'); assert.equal(result.failureStage, stage);
    assert.ok(result.responseShape.length > 0); assert.notEqual(result.state, 'success');
  });
}
test('공시지가 정상 0건·잘못된 봉투·배열·페이지·복수 행 구분', () => {
  const empty = { indvdLandPrices: { totalCount: '0', field: [] } };
  assert.equal(api.summarizeAttributeResponse('price', empty, id, '2025').state, 'not-found');
  const cases = [ [{ wrongEnvelope: {} }, 'envelope'], [{ indvdLandPrices: { totalCount: '1', field: 'SECRET' } }, 'rows'] ];
  for (const [payload, stage] of cases) assert.equal(api.summarizeAttributeResponse('price', payload, id, '2025').failureStage, stage);
  for (const changes of [{ pageNo: '2' }, { totalCount: '0' }, { numOfRows: '0' }]) {
    const value = priceResponse(); Object.assign(value.indvdLandPrices, changes);
    assert.equal(api.summarizeAttributeResponse('price', value, id, '2025').failureStage, 'page');
  }
  const multiple = priceResponse(); multiple.indvdLandPrices.totalCount = '2';
  multiple.indvdLandPrices.field.push({ ...multiple.indvdLandPrices.field[0], stdrMt: '07' });
  const result = api.summarizeAttributeResponse('price', multiple, id, '2025');
  assert.equal(result.state, 'success'); assert.equal(result.priceRecords.length, 2); assert.equal(result.priceCompleteness, 'complete');
});

test('실증 구조 모의 2건: 기준월·공시일·가격 보존, 최신 한 건 자동 선택 없음', () => {
  const value = priceResponse(); value.indvdLandPrices.totalCount = '2';
  value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0], stdrMt: '07', pblntfPclnd: '12000', pblntfDe: '2025-10-31', lastUpdtDt: '2025-11-01' });
  const result = api.summarizeAttributeResponse('price', value, id, '2025');
  assert.equal(result.state, 'success'); assert.equal(result.count, 2); assert.equal(result.totalCount, 2);
  assert.deepEqual(result.priceRecords.map((row) => [row.year, row.month, row.pricePerSquareMeter, row.publishedAt]),
    [['2025', '01', 10000, '2025-04-30'], ['2025', '07', 12000, '2025-10-31']]);
  assert.equal(result.price, undefined); assert.equal(result.year, null); assert.equal(result.date, null);
  assert.equal(result.priceRecords.some((row) => 'pnu' in row), false);
});
test('완전 중복만 제거하고 원본 반환 건수로 페이지 완전성 판정', () => {
  const value = priceResponse(); value.indvdLandPrices.totalCount = '2';
  value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0] });
  const result = api.summarizeAttributeResponse('price', value, id, '2025');
  assert.equal(result.count, 2); assert.equal(result.priceRecords.length, 1); assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.priceCompleteness, 'complete');
});
for (const changes of [{ pblntfDe: '2025-05-01' }, { lastUpdtDt: '2025-05-02' }, { pblntfPclnd: '10001' }, { stdrMt: '07' }, { stdLandAt: 'Y' }, { pblntfPclnd: 10000 }]) {
  test(`공시지가 다른 행은 병합하지 않음: ${Object.keys(changes)[0]} ${typeof Object.values(changes)[0]}`, () => {
    const value = priceResponse(); value.indvdLandPrices.totalCount = '2';
    value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0], ...changes });
    const result = api.summarizeAttributeResponse('price', value, id, '2025');
    assert.equal(result.state, 'success'); assert.equal(result.priceRecords.length, 2); assert.equal(result.duplicatesRemoved, 0);
  });
}
test('부분 조회·메타데이터 미확인, 추가 페이지 전송 없음', async () => {
  const partial = priceResponse(); partial.indvdLandPrices.totalCount = '11';
  const result = api.summarizeAttributeResponse('price', partial, id, '2025');
  assert.equal(result.state, 'success'); assert.equal(result.priceCompleteness, 'partial'); assert.match(result.message, /일부/);
  const unknown = priceResponse(); delete unknown.indvdLandPrices.pageNo;
  assert.equal(api.summarizeAttributeResponse('price', unknown, id, '2025').priceCompleteness, 'unknown');
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = partial;
  const module = await load(true, true); const livePath = await module.runAttributeProbe('price', id, '2025');
  assert.equal(m.calls.length, 1); assert.equal(livePath.priceCompleteness, 'partial'); assert.match(livePath.message, /일부/);
});
test('첫 행 정상이어도 두 번째 PNU·연도 오류를 숨기지 않음', () => {
  for (const [changes, stage] of [[{ pnu: '1114010300100310001' }, 'pnu'], [{ stdrYear: '2024' }, 'year']]) {
    const value = priceResponse(); value.indvdLandPrices.totalCount = '2';
    value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0], ...changes });
    const result = api.summarizeAttributeResponse('price', value, id, '2025');
    assert.equal(result.state, 'failed'); assert.equal(result.failureStage, stage); assert.equal(result.priceRecords, undefined);
  }
});
test('공시지가 API 오류와 형식 오류 구분, 구조 요약은 비밀 값·임의 필드명 제외', () => {
  const error = api.summarizeAttributeResponse('price', { response: { status: 'ERROR', error: { code: 'INCORRECT_KEY', text: 'SECRET' } } }, id, '2025');
  assert.equal(error.diagnostic, 'ATTRIBUTE_AUTH'); assert.ok(error.responseShape.length > 0);
  const value = priceResponse({ stdrYear: 2025, secretFieldSECRET: 'SECRET', pblntfDe: 'https://secret.invalid/SECRET' });
  value.indvdLandPrices.topSecretSECRET = 'SECRET';
  const result = api.summarizeAttributeResponse('price', value, id, '2025');
  const summary = result.responseShape.join('\n');
  assert.match(summary, /stdrYear: number/); assert.match(summary, /field: array\(1\)/);
  assert.equal(summary.includes(id), false); assert.equal(summary.includes('SECRET'), false); assert.equal(summary.includes('secret.invalid'), false);
});
test('공통 전송: 세 경로의 CSP·source/origin/ID 검증·정리', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const listeners = new Set(); const frames = [];
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173' }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  globalThis.document = { createElement: () => ({ contentWindow: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } }), body: { append: (frame) => frames.push(frame) } };
  try {
    for (const [service, path] of [['cadastral', '/req/data'], ['ledger', '/ned/data/ladfrlList'], ['price', '/ned/data/getIndvdLandPriceAttr']]) {
      const controller = new AbortController();
      const promise = service === 'cadastral' ? api.requestCadastralJsonp(new URLSearchParams(), controller.signal) : api.requestSandboxJsonp(service, new URLSearchParams(), controller.signal);
      const frame = frames.at(-1); assert.equal(frame.attrs.sandbox, 'allow-scripts');
      assert.ok(frame.srcdoc.includes(`https://api.vworld.kr${path}; base-uri`));
      const id = /channel:'imjinhong-parcel',id:"([^"]+)"/.exec(frame.srcdoc)[1];
      const receive = [...listeners][0];
      receive({ source: {}, origin: 'null', data: { channel: 'imjinhong-parcel', id, type: 'result', payload: {} } }); assert.equal(frame.removed, undefined);
      receive({ source: frame.contentWindow, origin: 'http://wrong', data: { channel: 'imjinhong-parcel', id, type: 'result' } }); assert.equal(frame.removed, undefined);
      receive({ source: frame.contentWindow, origin: 'null', data: { channel: 'imjinhong-parcel', id: 'wrong', type: 'result' } }); assert.equal(frame.removed, undefined);
      receive({ source: frame.contentWindow, origin: 'null', data: { channel: 'imjinhong-parcel', id, type: 'result', payload: { ok: true } } });
      assert.deepEqual(await promise, { ok: true }); assert.equal(frame.removed, true); assert.equal(listeners.size, 0);
    }
    const controller = new AbortController(); const pending = api.requestSandboxJsonp('ledger', new URLSearchParams(), controller.signal); controller.abort();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(frames.at(-1).removed, true); assert.equal(listeners.size, 0);
    await assert.rejects(api.requestSandboxJsonp('invalid', new URLSearchParams(), new AbortController().signal), /허용되지/);
  } finally { globalThis.window = originalWindow; globalThis.document = originalDocument; }
});
test('진단 UI는 main에서 참조하지 않고 Vite serve 전용 경로로만 제공', async () => {
  assert.equal((await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')).includes('attributeProbe'), false);
  assert.match(await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'), /apply: 'serve'/);
});

test('지도용 실제 로더: 기존 인증·서비스별 파라미터·복수 가격 파서 재사용', async () => {
  const module = await load(true, true), m = globalThis.attributeProbeMocks;
  const auth = { apiKey: 'offline-test-key', domain: 'https://example.invalid/registered/' };
  m.calls = []; m.payload = ledger;
  assert.equal((await module.loadLandLedger(id, auth, new AbortController().signal)).status, 'ok');
  m.payload = priceResponse();
  m.payload.indvdLandPrices.totalCount = '2';
  m.payload.indvdLandPrices.field.push({ ...m.payload.indvdLandPrices.field[0], lastUpdtDt: '2026-02-05' });
  const price = await module.loadLandPrice(id, '2025', auth, new AbortController().signal);
  assert.equal(price.status, 'ok'); assert.equal(price.value.records.length, 2);
  assert.deepEqual(m.calls.map((call) => call.service), ['ledger', 'price']);
  assert.equal(m.calls[0].parameters.has('stdrYear'), false); assert.equal(m.calls[1].parameters.get('stdrYear'), '2025');
});
test('지도용 로더: API 실패·자료 없음·PNU 오류 구분, 자동 재시도 없음', async () => {
  const module = await load(true, true), m = globalThis.attributeProbeMocks;
  const auth = { apiKey: 'offline-test-key', domain: 'https://example.invalid/registered/' };
  m.calls = []; m.payload = { response: { status: 'ERROR', error: { text: 'DO_NOT_SHOW' } } };
  const failure = await module.loadLandPrice(id, '2025', auth, new AbortController().signal);
  assert.equal(failure.status, 'error'); assert.equal(JSON.stringify(failure).includes('DO_NOT_SHOW'), false); assert.equal(m.calls.length, 1);
  m.payload = { indvdLandPrices: { totalCount: '0', field: [] } };
  assert.equal((await module.loadLandPrice(id, '2025', auth, new AbortController().signal)).status, 'not-found');
  m.payload = priceResponse({ pnu: '1114010300100310001' });
  assert.equal((await module.loadLandPrice(id, '2025', auth, new AbortController().signal)).status, 'error');
  assert.equal(m.calls.length, 3);
});

function historyResponse() {
  const value = priceResponse(); value.indvdLandPrices.totalCount = '3';
  value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0], lastUpdtDt: '2026-02-05' },
    { ...value.indvdLandPrices.field[0], stdrYear: '2024', pblntfPclnd: '9000', pblntfDe: '2024-04-30' });
  return value;
}
test('연도 생략: stdrYear 파라미터 자체를 보내지 않고 첫 페이지 1회만 요청', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = historyResponse();
  const module = await load(true, true); assert.equal(m.calls.length, 0);
  const result = await module.runAttributeProbe('price', id, undefined);
  assert.equal(m.calls.length, 1); const params = m.calls[0].parameters;
  assert.equal(params.has('stdrYear'), false); assert.equal(params.get('pageNo'), '1'); assert.equal(params.get('numOfRows'), '10');
  assert.equal(result.state, 'success'); assert.equal(result.yearMode, 'omitted'); assert.equal(result.priceCompleteness, 'complete');
  assert.deepEqual(result.returnedYears, ['2024', '2025']); assert.equal(result.historyCoverage, 'unknown');
  assert.equal(result.priceRecords.length, 3); assert.equal(result.priceRecords[1].updatedAt, '2026-02-05');
});
test('지정 연도는 2025 유지, 빈 입력을 연도 생략으로 취급하지 않음', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = priceResponse();
  const module = await load(true, true);
  assert.equal((await module.runAttributeProbe('price', id, '')).state, 'blocked'); assert.equal(m.calls.length, 0);
  assert.equal((await module.runAttributeProbe('price', id, '2025')).state, 'success');
  assert.equal(m.calls[0].parameters.get('stdrYear'), '2025');
  assert.equal(api.summarizeAttributeResponse('price', historyResponse(), id, '2025').failureStage, 'year');
});
test('연도 생략도 실제 반환 연도 형식과 PNU 검증 유지', () => {
  for (const [changes, stage] of [[{ stdrYear: undefined }, 'year'], [{ stdrYear: 2025 }, 'year'], [{ stdrYear: '25' }, 'year'], [{ pnu: '1114010300100310001' }, 'pnu']]) {
    const result = api.summarizeAttributeResponse('price', priceResponse(changes), id, undefined);
    assert.equal(result.state, 'failed'); assert.equal(result.failureStage, stage);
  }
});
test('연도 생략 부분 페이지·메타데이터 누락은 전체 이력 성공으로 과장하지 않음', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = historyResponse(); m.payload.indvdLandPrices.totalCount = '25';
  const module = await load(true, true); const result = await module.runAttributeProbe('price', id, undefined);
  assert.equal(result.priceCompleteness, 'partial'); assert.equal(result.historyCoverage, 'unknown'); assert.equal(result.totalCount, 25);
  assert.equal(m.calls.length, 1);
  const missing = historyResponse(); delete missing.indvdLandPrices.pageNo;
  assert.equal(api.summarizeAttributeResponse('price', missing, id, undefined).priceCompleteness, 'unknown');
});
test('연도 생략 0건·오류 구분, 완전 중복만 제거', () => {
  assert.equal(api.summarizeAttributeResponse('price', { indvdLandPrices: { totalCount: '0', field: [] } }, id, undefined).state, 'not-found');
  const value = historyResponse(); value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0] }); value.indvdLandPrices.totalCount = '4';
  const result = api.summarizeAttributeResponse('price', value, id, undefined);
  assert.equal(result.count, 4); assert.equal(result.priceRecords.length, 3); assert.equal(result.duplicatesRemoved, 1);
  const error = api.summarizeAttributeResponse('price', { response: { status: 'ERROR', error: { code: 'INCORRECT_KEY' } } }, id, undefined);
  assert.equal(error.state, 'failed'); assert.equal(error.diagnostic, 'ATTRIBUTE_AUTH');
});
test('연도 생략은 프로덕션 차단, 지정 조회와 동시 중복 요청 억제', async () => {
  const prod = await load(false, true); const m = globalThis.attributeProbeMocks; m.calls = [];
  assert.equal((await prod.runAttributeProbe('price', id, undefined)).state, 'blocked'); assert.equal(m.calls.length, 0);
  const module = await load(true, true); let resolve; m.pending = new Promise((done) => { resolve = done; });
  const pending = module.runAttributeProbe('price', id, undefined);
  assert.equal((await module.runAttributeProbe('price', id, '2025')).state, 'blocked'); assert.equal(m.calls.length, 1);
  resolve(priceResponse()); await pending; m.pending = null;
});

function secondPageResponse() {
  const value = historyResponse();
  value.indvdLandPrices.totalCount = '13'; value.indvdLandPrices.pageNo = '2';
  return value;
}
test('생략 2페이지: pageNo=2·10건 설정으로 딱 1회, 실제 반환 3건 표시', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = secondPageResponse();
  const module = await load(true, true);
  const result = await module.runAttributeProbe('price', id, undefined, new AbortController().signal, 2);
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0].parameters.get('pageNo'), '2');
  assert.equal(m.calls[0].parameters.get('numOfRows'), '10'); assert.equal(m.calls[0].parameters.has('stdrYear'), false);
  assert.equal(result.state, 'success'); assert.equal(result.count, 3); assert.equal(result.totalCount, 13);
  assert.equal(result.requestedPage, 2); assert.equal(result.pageNo, 2); assert.equal(result.pageSize, 10);
  assert.equal(result.priceRecords.length, 3); assert.equal(result.priceCompleteness, 'partial'); assert.equal(result.historyCoverage, 'unknown');
});
test('생략 1페이지는 기본값 유지, 2025 지정·토지임야는 2페이지 차단', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = historyResponse();
  const module = await load(true, true);
  await module.runAttributeProbe('price', id, undefined);
  assert.equal(m.calls[0].parameters.get('pageNo'), '1');
  for (const [service, year, page] of [['price', '2025', 2], ['ledger', '', 2], ['price', undefined, 0], ['price', undefined, 3], ['price', undefined, 1.5]]) {
    assert.equal((await module.runAttributeProbe(service, id, year, new AbortController().signal, page)).state, 'blocked');
  }
  assert.equal(m.calls.length, 1);
});
test('2페이지 응답은 요청 페이지 일치·전체 건수의 남은 수 검사', () => {
  assert.equal(api.summarizeAttributeResponse('price', secondPageResponse(), id, undefined).failureStage, 'page');
  const wrong = secondPageResponse(); wrong.indvdLandPrices.pageNo = '1';
  assert.equal(api.summarizeAttributeResponse('price', wrong, id, undefined, 2).failureStage, 'page');
  const excess = secondPageResponse(); excess.indvdLandPrices.totalCount = '12';
  assert.equal(api.summarizeAttributeResponse('price', excess, id, undefined, 2).failureStage, 'page');
});
test('2페이지 마지막 페이지라도 전체 이력으로 오인하지 않고 중복·상이한 갱신일 보존', () => {
  const value = secondPageResponse(); value.indvdLandPrices.totalCount = '14'; value.indvdLandPrices.field.push({ ...value.indvdLandPrices.field[0] });
  const result = api.summarizeAttributeResponse('price', value, id, undefined, 2);
  assert.equal(result.state, 'success'); assert.equal(result.count, 4); assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.priceRecords.length, 3); assert.equal(result.priceCompleteness, 'partial');
  assert.equal(result.priceRecords[1].updatedAt, '2026-02-05');
});
test('2페이지 오류·프로덕션 실행은 추가 요청 없음', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = { response: { status: 'ERROR', error: { code: 'INCORRECT_KEY' } } };
  const module = await load(true, true);
  assert.equal((await module.runAttributeProbe('price', id, undefined, new AbortController().signal, 2)).diagnostic, 'ATTRIBUTE_AUTH');
  assert.equal(m.calls.length, 1);
  const prod = await load(false, true);
  assert.equal((await prod.runAttributeProbe('price', id, undefined, new AbortController().signal, 2)).state, 'blocked');
  assert.equal(m.calls.length, 1);
});
test('지도 이력용 로더는 연도를 생략하고 메타데이터에 필요한 4페이지도 1회 요청', async () => {
  const m = globalThis.attributeProbeMocks; m.calls = []; m.payload = priceResponse({ stdrYear: '2026' });
  m.payload.indvdLandPrices.totalCount = '31'; m.payload.indvdLandPrices.pageNo = '4';
  const module = await load(true, true);
  const result = await module.loadLandPricePage(id, { apiKey: 'offline-test-key', domain: 'https://example.invalid/' }, new AbortController().signal, 4);
  assert.equal(result.status, 'ok'); assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].parameters.get('pageNo'), '4'); assert.equal(m.calls[0].parameters.has('stdrYear'), false);
});
