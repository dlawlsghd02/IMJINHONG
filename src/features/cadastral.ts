import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import { transform, transformExtent } from 'ol/proj.js';
import { unByKey } from 'ol/Observable.js';
import { parcelConfig } from '../config/parcel';
import { createCadastralProvider, validateParcelBox } from '../services/vworld/cadastral';
import type { ParcelFeature } from '../services/vworld/cadastral';
import { loadLandLedger } from '../services/vworld/landLedger';
import { loadLandPrice } from '../services/vworld/landPrice';
import { ParcelError, pnu, text } from '../services/vworld/parcelValidation';
import { createParcelPanel } from '../ui/parcelPanel';
import type { MapFeature } from './types';

export const cadastralFeature: MapFeature = {
  id: 'cadastral',
  mount({ map, parcelControlsHost, parcelPanelHost, vworldApiKey }) {
    const provider = createCadastralProvider(vworldApiKey);
    const boundaries = new VectorSource<ParcelFeature>();
    const selected = new VectorSource<ParcelFeature>();
    const boundaryLayer = new VectorLayer({ source: boundaries,
      style: new Style({ stroke: new Stroke({ color: '#745623', width: 1.5 }) }),
      visible: false, minZoom: parcelConfig.minZoom - 0.001 });
    const selectionLayer = new VectorLayer({ source: selected,
      style: new Style({ stroke: new Stroke({ color: '#006bd6', width: 3 }), fill: new Fill({ color: 'rgba(0,107,214,0.15)' }) }), visible: false });
    boundaryLayer.setZIndex(40); selectionLayer.setZIndex(50);
    let enabled = false, disposed = false, generation = 0;
    let pointController: AbortController | undefined, boxController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingPoint = '', completedBox = '';
    const panel = createParcelPanel(toggle, clearSelection);
    const invalidate = () => {
      generation++;
      pointController?.abort(); boxController?.abort();
      pointController = undefined; boxController = undefined; pendingPoint = '';
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    function clearSelection() {
      invalidate(); selected.clear(); panel.clear();
      if (enabled) ready();
    }
    function ready() {
      if (!enabled) panel.setStatus('지적도 꺼짐');
      else if ((map.getView().getZoom() ?? 0) < parcelConfig.minZoom) panel.setStatus('17단계 이상 확대 후 지도를 눌러 필지를 조회하세요.');
      else panel.setStatus(parcelConfig.autoBoundaryQueryEnabled ? '지도를 눌러 필지를 선택하세요.' : '자동 경계 조회는 검증 전 비활성입니다. 지도를 눌러 1필지를 조회하세요.');
    }
    function toggle() {
      enabled = !enabled;
      invalidate(); boundaries.clear(); completedBox = ''; selected.clear(); panel.clear();
      boundaryLayer.setVisible(enabled); selectionLayer.setVisible(enabled);
      panel.setEnabled(enabled); ready();
      if (enabled) scheduleBoundaries();
    }
    async function show(feature: ParcelFeature, token: number) {
      if (disposed || !enabled || token !== generation) return;
      const id = pnu(feature.get('pnu'));
      selected.clear(); selected.addFeature(feature.clone());
      panel.showSelection(id, text(feature.get('jibun')));
      panel.setStatus('선택 필지 상세정보 확인 중…', true);
      // 어댑터가 조회 불가를 반환해도 선택 도형과 기본 지도는 유지한다.
      const results = await Promise.allSettled([loadLandLedger(id), loadLandPrice(id, parcelConfig.priceYear)]);
      if (disposed || !enabled || token !== generation) return;
      const [ledger, price] = results;
      panel.renderLedger(ledger.status === 'fulfilled' ? ledger.value : { status: 'error', message: '토지임야 속성을 처리하지 못했습니다.' });
      panel.renderPrice(price.status === 'fulfilled' ? price.value : { status: 'error', message: '개별공시지가를 처리하지 못했습니다.' });
      panel.setStatus('필지 선택 완료. 상세 속성은 브라우저 전송 검증 전 조회 불가입니다.');
    }
    async function selectAt(coordinate: number[]) {
      if (disposed || !enabled || (map.getView().getZoom() ?? 0) < parcelConfig.minZoom) { ready(); return; }
      const requestKey = coordinate.join(',');
      if (pendingPoint === requestKey) return;
      invalidate(); selected.clear(); panel.clear();
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
        await show(candidates[0], token);
      } catch (error) {
        if (!disposed && token === generation && !controller.signal.aborted) panel.setStatus(error instanceof ParcelError ? error.message : '필지 조회를 처리하지 못했습니다. 기본 지도는 계속 사용할 수 있습니다.');
      } finally {
        if (pointController === controller) { pointController = undefined; pendingPoint = ''; }
      }
    }
    async function refreshBoundaries() {
      if (disposed || !enabled || !parcelConfig.autoBoundaryQueryEnabled || (map.getView().getZoom() ?? 0) < parcelConfig.minZoom) return;
      const size = map.getSize(); if (!size) return;
      const token = generation;
      let controller: AbortController | undefined;
      try {
        const box = transformExtent(map.getView().calculateExtent(size), 'EPSG:3857', 'EPSG:4326');
        validateParcelBox(box);
        const key = box.join(',');
        if (key === completedBox || boxController) return;
        controller = new AbortController(); boxController = controller;
        panel.setStatus('화면 범위 지적 경계 조회 중…', true);
        const batch = await provider.box(box, controller.signal);
        if (disposed || !enabled || token !== generation || controller.signal.aborted) return;
        boundaries.clear(); boundaries.addFeatures(batch.features); completedBox = key;
        panel.setStatus(batch.truncated ? '경계 응답이 상한에 도달해 일부 필지가 누락될 수 있습니다. 추가 페이지는 요청하지 않습니다.' : `지적 경계 ${batch.features.length}건. 지도를 눌러 필지를 선택하세요.`);
      } catch (error) {
        if (!disposed && token === generation && !controller?.signal.aborted) panel.setStatus(error instanceof ParcelError ? error.message : '화면 범위 경계를 조회하지 못했습니다.');
      } finally { if (boxController === controller) boxController = undefined; }
    }
    function scheduleBoundaries() {
      if (timer !== undefined) clearTimeout(timer);
      ready();
      if (!enabled || !parcelConfig.autoBoundaryQueryEnabled) return;
      timer = setTimeout(() => { timer = undefined; void refreshBoundaries(); }, parcelConfig.moveDelayMs);
    }
    const events = [
      map.on('movestart', () => {
        invalidate(); boundaries.clear(); completedBox = ''; selected.clear(); panel.clear(); ready();
      }),
      map.on('moveend', scheduleBoundaries),
      map.on('singleclick', (event) => {
        // 검색 마커 등 다른 기능의 벡터를 누른 경우 필지 요청을 발생시키지 않는다.
        if (!enabled || map.hasFeatureAtPixel(event.pixel, { layerFilter: (layer) => layer !== boundaryLayer && layer !== selectionLayer })) return;
        void selectAt(event.coordinate.slice());
      }),
    ];
    const dispose = () => {
      disposed = true; invalidate(); unByKey(events); panel.dispose();
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
