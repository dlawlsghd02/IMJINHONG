import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import { transform, transformExtent } from 'ol/proj.js';
import { unByKey } from 'ol/Observable.js';
import { parcelConfig } from '../config/parcel';
import { createCadastralProvider, validateParcelBox } from '../services/vworld/cadastral';
import type { ParcelBatch, ParcelFeature } from '../services/vworld/cadastral';
import { createParcelBoundaryCache } from './parcelBoundaryCache';
import { loadLandLedger } from '../services/vworld/landLedger';
import { loadLandPricePage } from '../services/vworld/landPrice';
import { createLandPriceHistory } from './landPriceHistory';
import { ParcelError, pnu, text } from '../services/vworld/parcelValidation';
import { createParcelPanel } from '../ui/parcelPanel';
import type { MapFeature } from './types';

export const cadastralFeature: MapFeature = {
  id: 'cadastral',
  mount({ map, parcelControlsHost, parcelPanelHost, vworldApiKey, vworldDomain }) {
    const provider = createCadastralProvider(vworldApiKey, vworldDomain);
    const boundaries = new VectorSource<ParcelFeature>();
    const selected = new VectorSource<ParcelFeature>();
    const boundaryLayer = new VectorLayer({ source: boundaries,
      style: new Style({ stroke: new Stroke({ color: '#745623', width: 1.5 }) }),
      visible: false, minZoom: parcelConfig.boxMinZoom - 0.001 });
    const selectionLayer = new VectorLayer({ source: selected,
      style: new Style({ stroke: new Stroke({ color: '#006bd6', width: 3 }), fill: new Fill({ color: 'rgba(0,107,214,0.15)' }) }), visible: false });
    boundaryLayer.setZIndex(40); selectionLayer.setZIndex(50);
    let enabled = false, disposed = false, generation = 0;
    let boxGeneration = 0, pointStatusLocked = false;
    let lastBoxRequestAt = -Infinity;
    let lastSettledBox = '', lastSettledMessage = '';
    let lastSettledExpiresAt = Infinity;
    let lastDisplayedBox = '';
    const cache = createParcelBoundaryCache();
    let pointController: AbortController | undefined, boxController: AbortController | undefined;
    let attributesPending: { ledger: boolean; price: boolean } | undefined;
    const attributeAuth = { apiKey: vworldApiKey, domain: vworldDomain };
    const priceHistory = createLandPriceHistory((id, page, signal) => loadLandPricePage(id, attributeAuth, signal, page));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingPoint = '', pendingBox = '';
    const panel = createParcelPanel(toggle, clearSelection);
    const invalidate = () => {
      generation++;
      pointController?.abort();
      pointController = undefined; pendingPoint = '';
      attributesPending = undefined;
    };
    const invalidateBox = () => {
      boxGeneration++;
      boxController?.abort(); boxController = undefined; pendingBox = '';
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    function clearSelection() {
      invalidate(); selected.clear(); panel.clear(); pointStatusLocked = false;
      if (enabled) ready();
    }
    function ready() {
      if (!enabled) panel.setStatus('지적도 꺼짐');
      else if ((map.getView().getZoom() ?? 0) < parcelConfig.pointMinZoom) panel.setStatus('17단계 이상 확대 후 지도를 눌러 필지를 조회하세요.');
      else panel.setStatus('지도를 눌러 1필지를 조회하세요.');
    }
    function toggle() {
      enabled = !enabled;
      const pointWasPending = !!pointController;
      const canceledAttributes = attributesPending;
      invalidate(); invalidateBox();
      if (canceledAttributes && (canceledAttributes.ledger || canceledAttributes.price) && selected.getFeatures().length) {
        if (canceledAttributes.ledger) panel.renderLedger({ status: 'error', message: '지적도 전환으로 조회가 취소되었습니다. 다시 필지를 선택하세요.' });
        if (canceledAttributes.price) panel.renderPrice({ status: 'error', message: '지적도 전환으로 조회가 취소되었습니다. 다시 필지를 선택하세요.' });
        panel.setStatus('선택 필지 유지. 진행 중이던 속성 조회는 취소했습니다.');
      }
      if (pointWasPending && !selected.getFeatures().length) pointStatusLocked = false;
      boundaryLayer.setVisible(enabled); selectionLayer.setVisible(enabled);
      panel.setEnabled(enabled);
      panel.setFeatureVisible(enabled, selected.getFeatures().length > 0);
      if (enabled) {
        // 사용자가 다시 ON 한 경우는 새 조회 의사다. 자동 재시도와 구분한다.
        lastSettledBox = ''; lastSettledMessage = ''; lastSettledExpiresAt = Infinity;
        if (!pointStatusLocked && !selected.getFeatures().length) ready();
        if (!restoreCachedBoundaries()) { boundaries.clear(); scheduleBoundaries(); }
      }
      else panel.setBoundaryStatus('');
    }
    async function show(feature: ParcelFeature, token: number, signal: AbortSignal) {
      if (disposed || !enabled || token !== generation) return;
      const id = pnu(feature.get('pnu'));
      selected.clear(); selected.addFeature(feature.clone());
      panel.showSelection(id, text(feature.get('jibun')));
      panel.setStatus('선택 필지 상세정보 확인 중…', true);
      const pending = { ledger: true, price: true }; attributesPending = pending;
      const current = () => !disposed && enabled && token === generation && !signal.aborted;
      // 한 서비스가 느리거나 실패해도 완료된 다른 서비스 결과는 즉시 표시한다.
      await Promise.allSettled([
        loadLandLedger(id, attributeAuth, signal).then((state) => {
          if (!current()) return; pending.ledger = false; panel.renderLedger(state);
        }, () => {
          if (!current()) return; pending.ledger = false; panel.renderLedger({ status: 'error', message: '토지임야 조회를 처리하지 못했습니다.' });
        }),
        priceHistory.load(id, signal, (snapshot) => {
          if (!current()) return;
          panel.renderPrice({ status: 'ok', value: snapshot.batch }, snapshot);
        }).then(() => {
          if (!current()) return; pending.price = false;
        }, () => {
          if (!current()) return; pending.price = false; panel.renderPrice({ status: 'error', message: '공시지가 조회를 처리하지 못했습니다.' });
        }),
      ]);
      if (!current()) return;
      attributesPending = undefined;
      panel.setStatus('필지 선택 완료. 토지정보와 공시지가 조회 결과를 확인하세요.');
    }
    async function selectAt(coordinate: number[]) {
      if (disposed || !enabled || (map.getView().getZoom() ?? 0) < parcelConfig.pointMinZoom) { ready(); return; }
      const requestKey = coordinate.join(',');
      if (pendingPoint === requestKey) return;
      invalidate(); selected.clear(); panel.clear();
      pointStatusLocked = true;
      const token = generation, controller = new AbortController();
      pointController = controller; pendingPoint = requestKey;
      panel.setStatus('클릭 위치의 필지 조회 중…', true);
      try {
        // 화면 레이어의 누락 가능성에 기대지 않고 클릭 위치를 공식 점조회로 확인한다.
        const lonLat = transform(coordinate, 'EPSG:3857', 'EPSG:4326');
        const batch = await provider.point(lonLat, controller.signal);
        if (disposed || !enabled || token !== generation || controller.signal.aborted) return;
        if (batch.truncated) throw new ParcelError('클릭 후보 응답이 잘렸습니다. 자동 선택하지 않습니다.');
        const candidates = batch.features.filter((feature) => feature.getGeometry()?.intersectsCoordinate(coordinate));
        if (batch.features.length && !candidates.length) throw new ParcelError('반환 도형이 클릭 위치와 일치하지 않습니다. 좌표계·위치 검증이 필요합니다.');
        if (!candidates.length) { panel.setStatus('클릭 위치에 조회 가능한 필지가 없습니다.'); return; }
        if (candidates.length !== 1) { panel.setStatus('여러 필지가 겹칩니다. 자동 선택하지 않습니다. 필지 내부를 다시 누르세요.'); return; }
        await show(candidates[0], token, controller.signal);
      } catch (error) {
        if (!disposed && token === generation && !controller.signal.aborted) panel.setStatus(error instanceof ParcelError ? error.message : '필지 조회를 처리하지 못했습니다. 기본 지도는 계속 사용할 수 있습니다.');
      } finally {
        if (pointController === controller) { pointController = undefined; pendingPoint = ''; }
      }
    }
    const boundaryStatus = (message: string, busy = false) => {
      panel.setBoundaryStatus(message, busy);
    };
    function displayBoundaries(batch: ParcelBatch, cached: boolean, key: string) {
      boundaries.clear(); boundaries.addFeatures(batch.features);
      lastDisplayedBox = key;
      const prefix = cached ? '경계 캐시 사용. ' : '';
      if (batch.completeness === 'partial') boundaryStatus(`${prefix}일부 경계 ${batch.features.length}건만 표시 중입니다. 더 확대하세요. 추가 페이지는 조회하지 않습니다.`);
      else if (batch.completeness === 'unknown') boundaryStatus(`${prefix}경계 ${batch.features.length}건. 응답 메타데이터가 불명확해 완전성은 미확인입니다.`);
      else boundaryStatus(`${prefix}현재 BOX 경계 ${batch.features.length}건. 응답 메타데이터 기준 전체 반환입니다.`);
    }
    function restoreCachedBoundaries(): boolean {
      if (!parcelConfig.autoBoundaryQueryEnabled || (map.getView().getZoom() ?? 0) < parcelConfig.boxMinZoom ||
          map.getView().getInteracting() || map.getView().getAnimating()) return false;
      const size = map.getSize();
      if (!size || size[0] <= 0 || size[1] <= 0) return false;
      try {
        const box = transformExtent(map.getView().calculateExtent(size), 'EPSG:3857', 'EPSG:4326');
        validateParcelBox(box);
        const key = `LP_PA_CBND_BUBUN|EPSG:4326|1|${parcelConfig.maxFeatures}|${box.join(',')}`;
        const cached = cache.get(key);
        if (!cached) return false;
        displayBoundaries(cached, true, key);
        return true;
      } catch { return false; } // 기존 예약 처리에서 안전한 범위 오류를 표시한다.
    }
    async function refreshBoundaries() {
      if (disposed || !enabled || !parcelConfig.autoBoundaryQueryEnabled || map.getView().getInteracting() || map.getView().getAnimating()) return;
      if ((map.getView().getZoom() ?? 0) < parcelConfig.boxMinZoom) {
        boundaryStatus('자동 경계는 15단계 이상에서 조회 후보가 됩니다. 더 확대하세요.'); return;
      }
      const size = map.getSize();
      if (!size || size[0] <= 0 || size[1] <= 0) { boundaryStatus('지도 화면 크기를 확인할 수 없습니다.'); return; }
      const token = boxGeneration;
      let controller: AbortController | undefined;
      let key = '';
      try {
        // 회전된 화면을 포함하는 외접 BOX 자체를 전송하고 그 면적을 검사한다.
        const box = transformExtent(map.getView().calculateExtent(size), 'EPSG:3857', 'EPSG:4326');
        validateParcelBox(box);
        key = `LP_PA_CBND_BUBUN|EPSG:4326|1|${parcelConfig.maxFeatures}|${box.join(',')}`;
        if (pendingBox === key || boxController) return;
        const cached = cache.get(key);
        if (cached) { displayBoundaries(cached, true, key); return; }
        const missingCache = lastDisplayedBox
          ? lastDisplayedBox === key ? '이전 경계 데이터의 캐시가 만료됐거나 저장 대상이 아닙니다.' : '현재 범위가 이전 경계 데이터의 조회 범위와 다릅니다.'
          : '현재 범위의 유효한 경계 캐시가 없습니다.';
        // 완료·실패한 동일 범위에 대한 자동 재시도는 하지 않는다.
        if (lastSettledBox === key && Date.now() < lastSettledExpiresAt) {
          boundaryStatus(`${missingCache} 이전 경계는 표시하지 않습니다. 동일 범위 추가 요청을 생략했습니다. ${lastSettledMessage}`); return;
        }
        const wait = parcelConfig.minBoxRequestIntervalMs - (performance.now() - lastBoxRequestAt);
        if (wait > 0) {
          boundaryStatus('경계 요청 간격 대기 중…');
          timer = setTimeout(() => { timer = undefined; if (token === boxGeneration) void refreshBoundaries(); }, wait);
          return;
        }
        controller = new AbortController(); boxController = controller; pendingBox = key;
        lastBoxRequestAt = performance.now();
        boundaryStatus('화면 범위 지적 경계 조회 중…', true);
        const batch = await provider.box(box, controller.signal);
        if (disposed || !enabled || token !== boxGeneration || controller.signal.aborted) return;
        const currentSize = map.getSize();
        if (!currentSize || map.getView().getInteracting() || map.getView().getAnimating()) return;
        const currentBox = transformExtent(map.getView().calculateExtent(currentSize), 'EPSG:3857', 'EPSG:4326');
        if (currentBox.join(',') !== box.join(',')) return;
        lastSettledBox = key;
        lastSettledExpiresAt = batch.completeness === 'complete' ? Date.now() + parcelConfig.cacheTtlMs : Infinity;
        lastSettledMessage = batch.completeness === 'complete' ? '이전 완전 응답은 재사용 가능한 캐시에 없습니다. TTL 이후 조회할 수 있습니다.' :
          batch.completeness === 'partial' ? '이전 응답은 일부 반환이었습니다. 더 확대하세요.' : '이전 응답은 완전성 미확인이었습니다. 더 확대하세요.';
        cache.put(key, batch);
        displayBoundaries(batch, false, key);
      } catch (error) {
        if (!disposed && token === boxGeneration && !controller?.signal.aborted) {
          const message = error instanceof ParcelError ? error.message : '화면 범위 경계를 조회하지 못했습니다.';
          if (controller) { lastSettledBox = key; lastSettledMessage = message; lastSettledExpiresAt = Infinity; }
          boundaryStatus(message);
        }
      } finally {
        if (controller && boxController === controller) { boxController = undefined; pendingBox = ''; }
      }
    }
    function scheduleBoundaries() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!pointStatusLocked && !pointController && !selected.getFeatures().length) ready();
      if (disposed || !enabled) return;
      if (!parcelConfig.autoBoundaryQueryEnabled) { panel.setBoundaryStatus('자동 BOX 경계 조회는 실제 검증 전 비활성입니다.'); return; }
      boundaryStatus('지도 이동 종료 후 경계 조회 대기 중…');
      timer = setTimeout(() => { timer = undefined; void refreshBoundaries(); }, parcelConfig.moveDelayMs);
    }
    const events = [
      map.on('movestart', () => {
        // POINT는 클릭 위치에 연결되므로 지도 이동만으로 선택·응답을 지우지 않는다.
        invalidateBox(); boundaries.clear();
        if (enabled && parcelConfig.autoBoundaryQueryEnabled) boundaryStatus('지도 이동 중에는 경계 조회를 중단합니다.');
      }),
      map.on('moveend', scheduleBoundaries),
      map.on('change:size', () => {
        invalidateBox(); boundaries.clear(); scheduleBoundaries();
      }),
      map.on('singleclick', (event) => {
        // 검색 마커 등 다른 기능의 벡터를 누른 경우 필지 요청을 발생시키지 않는다.
        if (!enabled || map.hasFeatureAtPixel(event.pixel, { layerFilter: (layer) => layer !== boundaryLayer && layer !== selectionLayer })) return;
        void selectAt(event.coordinate.slice());
      }),
    ];
    const dispose = () => {
      disposed = true; invalidate(); invalidateBox(); cache.clear(); priceHistory.dispose(); unByKey(events); panel.dispose();
      map.removeLayer(boundaryLayer); map.removeLayer(selectionLayer);
      boundaries.clear(); selected.clear(); boundaryLayer.dispose(); selectionLayer.dispose(); boundaries.dispose(); selected.dispose();
    };
    try {
      map.addLayer(boundaryLayer); map.addLayer(selectionLayer);
      parcelControlsHost.append(panel.controls); parcelPanelHost.append(panel.panel);
    } catch (error) { dispose(); throw error; }
    return dispose;
  },
};
