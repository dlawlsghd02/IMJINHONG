import type { LandPrice, LandPriceBatch } from '../services/vworld/landPrice';
import type { AttributeState } from '../services/vworld/parcelValidation';
import { pnu } from '../services/vworld/parcelValidation';

export interface PriceStatistic {
  record: LandPrice;
  rate: string;
  comparisonNote: string;
}
export interface PriceHistorySnapshot {
  batch: LandPriceBatch;
  phase: 'loading' | 'complete' | 'partial' | 'error' | 'not-found';
  latestYear: string | null;
  pagesLoaded: number;
  expectedPages: number | null;
  warning: string | null;
  statistics: PriceStatistic[];
}

export function priceStatistics(records: LandPrice[], complete: boolean): PriceStatistic[] {
  const groups = new Map<string, LandPrice>();
  records.forEach((record, index) => {
    const key = record.month !== null && record.publishedAt !== null && record.pricePerSquareMeter !== null
      ? JSON.stringify([record.pnu, record.year, record.month, record.publishedAt, record.pricePerSquareMeter]) : `missing-${index}`;
    if (!groups.has(key)) groups.set(key, record);
  });
  const values = [...groups.values()].sort((a, b) => Number(b.year) - Number(a.year) || (b.month ?? '').localeCompare(a.month ?? '') || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return values.map((record) => {
    let rate = '미산출', comparisonNote = '';
    const same = values.filter((value) => value.pnu === record.pnu && value.year === record.year);
    const previous = values.filter((value) => value.pnu === record.pnu && Number(value.year) === Number(record.year) - 1);
    if (!complete) comparisonNote = '전체 조회 미완료';
    else if (same.length !== 1 || previous.length > 1) comparisonNote = '복수 가격·기준시점으로 비교 불명확';
    else if (!previous.length) comparisonNote = '직전 연도 자료 미확인';
    else if (record.pricePerSquareMeter === null || previous[0].pricePerSquareMeter === null) comparisonNote = '가격 미제공';
    else if (previous[0].pricePerSquareMeter === 0) comparisonNote = '전년도 가격 0';
    else {
      const change = (record.pricePerSquareMeter - previous[0].pricePerSquareMeter) / previous[0].pricePerSquareMeter * 100;
      if (Number.isFinite(change)) rate = `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
      else comparisonNote = '계산 범위 초과';
      if (record.month === null || previous[0].month === null) comparisonNote = '기준월 미제공 — 비교 주의';
      else if (record.month !== previous[0].month) comparisonNote = '기준월 다름 — 비교 주의';
    }
    return { record, rate, comparisonNote };
  });
}

type PageLoader = (id: string, page: number, signal: AbortSignal) => Promise<AttributeState<LandPriceBatch>>;
const emptyBatch = (): LandPriceBatch => ({ records: [], returnedCount: 0, totalCount: null, pageSize: null, pageNo: null,
  completeness: 'unknown', duplicatesRemoved: 0, fields: [] });

// 지도 인스턴스별 캐시. 페이지 수집 상한과 별개로 저장 페이지 수만 제한한다.
export function createLandPriceHistory(loadPage: PageLoader, ttlMs = 60_000, cacheMaxPages = 64) {
  const cache = new Map<string, { expires: number; value: AttributeState<LandPriceBatch> }>();
  const running = new Map<string, { signal: AbortSignal; promise: Promise<PriceHistorySnapshot>; listeners: Set<(value: PriceHistorySnapshot) => void> }>();
  let disposed = false;
  const keyFor = (id: string, page: number) => `${id}|year=omitted|size=10|page=${page}`;
  function invalidateCache(id: string) {
    for (const key of cache.keys()) if (key.startsWith(`${id}|`)) cache.delete(key);
  }
  async function collect(id: string, signal: AbortSignal, emit: (value: PriceHistorySnapshot) => void) {
    const pages: LandPriceBatch[] = [], fingerprints = new Set<string>();
    let expectedPages: number | null = null, total: number | null = null;
    const current = () => !disposed && !signal.aborted;
    function snapshot(phase: PriceHistorySnapshot['phase'], warning: string | null): PriceHistorySnapshot {
      const records = pages.flatMap((page) => page.records);
      const complete = phase === 'complete';
      const batch = { ...emptyBatch(), records, returnedCount: pages.reduce((sum, page) => sum + page.returnedCount, 0),
        totalCount: total, pageSize: pages[0]?.pageSize ?? null, completeness: complete ? 'complete' as const : pages.length ? 'partial' as const : 'unknown' as const,
        duplicatesRemoved: pages.reduce((sum, page) => sum + page.duplicatesRemoved, 0), fields: [...new Set(pages.flatMap((page) => page.fields))] };
      return { batch, phase, warning, latestYear: complete ? records.reduce<string | null>((latest, record) => latest === null || record.year > latest ? record.year : latest, null) : null,
        pagesLoaded: pages.length, expectedPages, statistics: priceStatistics(records, complete) };
    }
    function stop(message: string, invalidate = false) {
      if (invalidate) invalidateCache(id);
      const result = snapshot(pages.length ? 'partial' : 'error', message); if (current()) emit(result); return result;
    }
    if (current()) emit(snapshot('loading', null));
    for (let pageNo = 1; current(); pageNo++) {
      let state: AttributeState<LandPriceBatch>;
      try {
        const now = Date.now(); for (const [key, value] of cache) if (value.expires <= now) cache.delete(key);
        const key = keyFor(id, pageNo), cached = cache.get(key);
        if (cached) { cache.delete(key); cache.set(key, cached); state = structuredClone(cached.value); }
        else state = await loadPage(id, pageNo, signal);
        if (!current()) return snapshot(pages.length ? 'partial' : 'error', '조회 취소');
        if (state.status === 'not-found' && pageNo === 1) {
          const result = snapshot('not-found', null); result.batch.totalCount = 0;
          cache.set(key, { expires: cached?.expires ?? Date.now() + ttlMs, value: structuredClone(state) });
          while (cache.size > cacheMaxPages) { const oldest = cache.keys().next().value; if (oldest === undefined) break; cache.delete(oldest); }
          emit(result); return result;
        }
        if (state.status !== 'ok') return stop('공시지가 페이지 조회에 실패했습니다. 자동 재시도하지 않습니다.');
        const batch = state.value;
        // 파서 결과라도 수집 경계에서 메타데이터와 PNU를 재확인한다.
        if (batch.records.some((record) => record.pnu !== id) || batch.pageNo !== pageNo || batch.pageSize !== 10 || batch.totalCount === null || !Number.isSafeInteger(batch.totalCount) || batch.totalCount < 0) {
          if (pageNo === 1 && batch.records.every((record) => record.pnu === id) && (batch.pageNo === null || batch.pageNo === pageNo) && (batch.pageSize === null || batch.pageSize === 10) && (batch.totalCount === null || Number.isSafeInteger(batch.totalCount) && batch.totalCount >= 0) && (batch.pageNo === null || batch.pageSize === null || batch.totalCount === null)) {
            pages.push(batch); return stop('페이지 메타데이터가 부족합니다. 확보된 자료만 표시하며 최신 연도는 미확인입니다.');
          }
          return stop('페이지 메타데이터 또는 PNU가 일치하지 않습니다.', true);
        }
        if (pageNo === 1) { total = batch.totalCount; expectedPages = Math.ceil(total / 10); }
        if (batch.totalCount !== total || batch.returnedCount !== Math.min(10, Math.max(0, batch.totalCount - (pageNo - 1) * 10)) || batch.records.length + batch.duplicatesRemoved !== batch.returnedCount) return stop('전체 건수·현재 건수·페이지 정보가 도중에 달라졌습니다.', true);
        const fingerprint = JSON.stringify(batch.records.map((record) => JSON.stringify(record)).sort());
        if (fingerprints.has(fingerprint)) return stop('이전 페이지와 같은 레코드가 반복되어 조회를 중단했습니다.', true);
        fingerprints.add(fingerprint); pages.push(batch);
        if (!cached) cache.set(key, { expires: Date.now() + ttlMs, value: structuredClone(state) });
        while (cache.size > cacheMaxPages) { const oldest = cache.keys().next().value; if (oldest === undefined) break; cache.delete(oldest); }
        if (expectedPages !== null && pageNo >= expectedPages) { const result = snapshot('complete', null); emit(result); return result; }
        emit(snapshot('loading', '최신 가용 연도 확인을 위해 다음 페이지를 조회 중입니다.'));
      } catch { return stop('공시지가 페이지 처리에 실패했습니다. 확보된 자료만 표시합니다.'); }
    }
    return snapshot(pages.length ? 'partial' : 'error', '조회 취소');
  }
  return {
    load(id: string, signal: AbortSignal, onProgress: (value: PriceHistorySnapshot) => void) {
      pnu(id);
      const previous = running.get(id);
      if (previous && previous.signal === signal && !signal.aborted) { previous.listeners.add(onProgress); return previous.promise; }
      const listeners = new Set([onProgress]);
      const emit = (value: PriceHistorySnapshot) => { if (!disposed && !signal.aborted) for (const listener of listeners) listener(value); };
      const promise = collect(id, signal, emit);
      const entry = { signal, promise, listeners }; running.set(id, entry);
      const cleanup = () => { if (running.get(id) === entry) running.delete(id); };
      void promise.then(cleanup, cleanup);
      return promise;
    },
    dispose() { disposed = true; cache.clear(); running.clear(); },
  };
}
