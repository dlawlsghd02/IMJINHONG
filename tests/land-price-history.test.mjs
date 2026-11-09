import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
globalThis.fetch = () => { throw new Error('외부 API 호출 금지'); };
const bundle = await build({ stdin: { contents: "export * from './src/features/landPriceHistory'; export { parseLandPrice } from './src/services/vworld/landPrice';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': 'undefined' } });
const { createLandPriceHistory, priceStatistics, parseLandPrice } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const id = '1120011300105280006', otherId = '1120011300105280007';
const row = (year, price, changes = {}) => ({ pnu: id, year: String(year), month: '01', pricePerSquareMeter: price, publishedAt: `${year}-04-30`, updatedAt: '2026-02-05', ...changes });
const records = [row(2017, 250000), row(2018, 260000), row(2019, 270000), row(2020, 280000), row(2021, 290000), row(2022, 300000), row(2023, 350000), row(2024, 396300, { updatedAt: '2025-06-18' }), row(2024, 396300), row(2025, 415200, { updatedAt: '2025-06-18' }), row(2025, 415200), row(2026, 436000), row(2023, 350000, { updatedAt: '2025-06-18' })];
function page(no, rows = records, changes = {}) {
  const values = rows.slice((no - 1) * 10, no * 10);
  return { status: 'ok', value: { records: values, returnedCount: values.length, totalCount: rows.length, pageSize: 10, pageNo: no,
    completeness: rows.length > values.length ? 'partial' : 'complete', duplicatesRemoved: 0, fields: ['pnu', 'stdrYear'], ...changes } };
}
function fixture(response = (no) => page(no), ...options) {
  const calls = [];
  const loader = createLandPriceHistory(async (id, no, signal) => { calls.push({ id, no, signal }); return response(no, id, signal); }, ...options);
  return { loader, calls };
}
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
test('13건/2페이지 순차 병합·2026년 최신·+5.01%, 원본 갱신일 보존', async () => {
  const { loader, calls } = fixture(), progress = [];
  const result = await loader.load(id, new AbortController().signal, (value) => progress.push(value));
  assert.deepEqual(calls.map((call) => call.no), [1, 2]); assert.equal(result.phase, 'complete');
  assert.equal(result.batch.returnedCount, 13); assert.equal(result.batch.records.length, 13); assert.equal(result.latestYear, '2026');
  assert.equal(result.statistics.find((value) => value.record.year === '2026').rate, '+5.01%');
  assert.equal(result.statistics.filter((value) => value.record.year === '2025').length, 1);
  assert.equal(result.batch.records.filter((value) => value.year === '2025').length, 2);
  assert.equal(progress.find((value) => value.pagesLoaded === 1).latestYear, null);
  assert.ok(progress.find((value) => value.pagesLoaded === 1).statistics.every((value) => value.rate === '미산출'));
  assert.equal(result.statistics.at(-1).record.year, '2017'); assert.equal(result.statistics.some((value) => value.record.year === '2016'), false);
  loader.dispose();
});
test('페이지 수는 2개로 고정하지 않고 총건수 기준으로 4페이지 수집', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => row(1996 + i, 100 + i));
  const { loader, calls } = fixture((no) => page(no, rows));
  const result = await loader.load(id, new AbortController().signal, () => {});
  assert.equal(result.phase, 'complete'); assert.deepEqual(calls.map((call) => call.no), [1, 2, 3, 4]);
  assert.equal(result.latestYear, '2026'); loader.dispose();
});
test('캐시 용량은 조회 페이지 상한이 아님, 원본 입력은 변경하지 않음', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => row(1996 + i, 100 + i));
  const before = JSON.stringify(rows);
  const { loader, calls } = fixture((no) => page(no, rows), 60000, 1);
  const result = await loader.load(id, new AbortController().signal, () => {});
  assert.equal(result.phase, 'complete'); assert.equal(calls.length, 4); assert.equal(result.batch.records.length, 31);
  assert.equal(JSON.stringify(rows), before); loader.dispose();
});
test('실제 파서도 생략 조회의 3페이지 이상을 허용하고 지정 연도는 그대로 1페이지', () => {
  const payload = { indvdLandPrices: { totalCount: '21', numOfRows: '10', pageNo: '3', field: [{ pnu: id, stdrYear: '2026', stdrMt: '01', pblntfPclnd: '436000', pblntfDe: '2026-04-30' }] } };
  assert.equal(parseLandPrice(payload, id, undefined, 3).status, 'ok');
  assert.throws(() => parseLandPrice(payload, id, '2026', 3));
});
test('다른 월/공시일/가격은 합치지 않으며 복수 기준은 증감률 미산출', () => {
  const rows = [row(2024, 100), row(2025, 110), row(2025, 120, { month: '07', publishedAt: '2025-10-31' }), row(2026, 130)];
  const result = priceStatistics(rows, true);
  assert.equal(result.filter((value) => value.record.year === '2025').length, 2);
  assert.ok(result.filter((value) => value.record.year !== '2024').every((value) => value.rate === '미산출'));
});
test('직전 연도 결측·0원·자료 미제공은 계산하지 않음', () => {
  for (const rows of [[row(2024, 100), row(2026, 110)], [row(2025, 0), row(2026, 110)], [row(2025, null), row(2026, 110)]]) {
    assert.equal(priceStatistics(rows, true)[0].rate, '미산출');
  }
});
test('기준월 차이는 주의 표시, 상승·하락·동일 가격 부호', () => {
  const result = priceStatistics([row(2022, 100), row(2023, 110), row(2024, 99), row(2025, 99), row(2026, 100, { month: '07' })], true);
  assert.equal(result.find((value) => value.record.year === '2023').rate, '+10.00%');
  assert.equal(result.find((value) => value.record.year === '2024').rate, '-10.00%');
  assert.equal(result.find((value) => value.record.year === '2025').rate, '0.00%');
  assert.match(result[0].comparisonNote, /기준월 다름/);
});
for (const changes of [{ totalCount: 14 }, { pageNo: 1 }, { pageSize: 20 }, { returnedCount: 2 }]) {
  test(`중간 페이지 메타데이터 불일치 중단: ${Object.keys(changes)[0]}`, async () => {
    const { loader, calls } = fixture((no) => page(no, records, no === 2 ? changes : {}));
    const result = await loader.load(id, new AbortController().signal, () => {});
    assert.equal(result.phase, 'partial'); assert.equal(result.latestYear, null); assert.equal(calls.length, 2);
    assert.ok(result.statistics.every((value) => value.rate === '미산출')); loader.dispose();
  });
}
test('중간 페이지 실패는 첫 페이지 보존, 새 명시적 선택 시 유효 페이지 재사용', async () => {
  let fail = true; const { loader, calls } = fixture((no) => no === 2 && fail ? { status: 'error', message: '테스트' } : page(no));
  const first = await loader.load(id, new AbortController().signal, () => {});
  assert.equal(first.phase, 'partial'); assert.equal(first.batch.records.length, 10); assert.equal(first.latestYear, null);
  fail = false; const second = await loader.load(id, new AbortController().signal, () => {});
  assert.equal(second.phase, 'complete'); assert.deepEqual(calls.map((call) => call.no), [1, 2, 2]); loader.dispose();
});
test('페이지 메타데이터 누락이면 추가 페이지 없음·최신 연도 미확인', async () => {
  const { loader, calls } = fixture((no) => page(no, records, { totalCount: null }));
  const result = await loader.load(id, new AbortController().signal, () => {});
  assert.equal(result.latestYear, null); assert.equal(result.phase, 'partial'); assert.equal(calls.length, 1); loader.dispose();
});
test('반복 페이지 데이터와 빈 중간 페이지는 중단', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(2000 + i, i + 100));
  for (const repeated of [true, false]) {
    const { loader, calls } = fixture((no) => no === 2 ? page(2, rows, { records: repeated ? rows.slice(0, 10) : [], returnedCount: repeated ? 10 : 0 }) : page(no, rows));
    const result = await loader.load(id, new AbortController().signal, () => {});
    assert.equal(result.phase, 'partial'); assert.equal(calls.length, 2); loader.dispose();
  }
});
test('진행 중 동일 선택은 공유, 완료 후 캐시와 TTL 만료·PNU 격리', async () => {
  const original = Date.now; let now = 1000; Date.now = () => now;
  try {
    const firstPage = deferred(); let first = true;
    const { loader, calls } = fixture((no, requestedId) => {
      if (first) { first = false; return firstPage.promise; }
      const result = page(no); result.value.records = result.value.records.map((value) => ({ ...value, pnu: requestedId })); return result;
    });
    const signal = new AbortController().signal;
    const one = loader.load(id, signal, () => {}), two = loader.load(id, signal, () => {});
    assert.equal(one, two); firstPage.resolve(page(1)); await one;
    const before = calls.length; await loader.load(id, new AbortController().signal, () => {}); assert.equal(calls.length, before);
    now += 60001; await loader.load(id, new AbortController().signal, () => {}); assert.equal(calls.length, before + 2);
    await loader.load(otherId, new AbortController().signal, () => {}); assert.equal(calls.length, before + 4); loader.dispose();
  } finally { Date.now = original; }
});
test('선택 변경·OFF·닫기용 abort: 늦은 응답 무시·다음 페이지 요청 없음', async () => {
  const waiting = deferred(), events = [];
  const { loader, calls } = fixture(() => waiting.promise); const controller = new AbortController();
  const pending = loader.load(id, controller.signal, (value) => events.push(value));
  controller.abort(); const count = events.length; waiting.resolve(page(1)); await pending;
  assert.equal(events.length, count); assert.equal(calls.length, 1); loader.dispose();
});
test('빈 자료·첫 페이지 실패를 구분하고 네트워크 재시도하지 않음', async () => {
  for (const [state, phase] of [[{ status: 'not-found', message: '없음' }, 'not-found'], [{ status: 'error', message: '실패' }, 'error']]) {
    const { loader, calls } = fixture(() => state); const result = await loader.load(id, new AbortController().signal, () => {});
    assert.equal(result.phase, phase); assert.equal(result.latestYear, null); assert.equal(calls.length, 1); loader.dispose();
  }
});
