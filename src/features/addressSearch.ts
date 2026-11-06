import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Circle, Fill, Stroke, Style } from 'ol/style.js';
import { transform } from 'ol/proj.js';
import { containsCoordinate } from 'ol/extent.js';
import { mapConfig } from '../config/map';
import { createAddressSearchProvider, SearchError } from '../services/vworld/search';
import type { AddressSearchItem, AddressSearchKind } from '../services/vworld/search';
import { createSearchPanel } from '../ui/searchPanel';
import type { MapFeature } from './types';

export const addressSearchFeature: MapFeature = {
  id: 'address-search',
  mount({ map, searchHost, vworldApiKey }) {
    const provider = createAddressSearchProvider(vworldApiKey);
    const source = new VectorSource<Feature<Point>>();
    const layer = new VectorLayer({ source,
      style: new Style({ image: new Circle({ radius: 9,
        fill: new Fill({ color: '#d14a24' }), stroke: new Stroke({ color: '#fff', width: 3 }) }) }),
    });
    layer.setZIndex(100);
    let generation = 0;
    let disposed = false;
    let active: AbortController | undefined;
    const invalidate = () => {
      generation++;
      active?.abort();
      active = undefined;
    };
    const panel = createSearchPanel((query, kind) => {
      void search(query, kind);
    }, () => {
      invalidate();
      source.clear();
      panel.clearResults();
      panel.setStatus('');
    });
    const select = (item: AddressSearchItem, token: number) => {
      if (disposed || token !== generation) return;
      try {
        const location = item.location;
        if (location.crs !== 'EPSG:4326' || !Number.isFinite(location.longitude) || !Number.isFinite(location.latitude) ||
            Math.abs(location.longitude) > 180 || Math.abs(location.latitude) > 90) {
          throw new Error('Invalid coordinate');
        }
        const coordinate = transform([location.longitude, location.latitude], 'EPSG:4326', mapConfig.viewProjection);
        if (!coordinate.every(Number.isFinite)) throw new Error('Invalid projected coordinate');
        const extent = map.getView().getProjection().getExtent();
        if (extent && !containsCoordinate(extent, coordinate)) throw new Error('Outside display projection extent');
        const marker = new Feature(new Point(coordinate));
        source.clear();
        source.addFeature(marker);
        const view = map.getView();
        view.cancelAnimations();
        view.animate({ center: coordinate, zoom: Math.min(18, view.getMaxZoom()), duration: 350 });
        panel.setStatus('');
      } catch {
        panel.setStatus('유효한 지도 좌표로 변환할 수 없어 위치 이동을 중단했습니다.');
      }
    };
    async function search(query: string, kind: AddressSearchKind) {
      if (disposed) return;
      invalidate();
      const token = generation;
      const controller = new AbortController();
      active = controller;
      source.clear();
      panel.clearResults();
      panel.setStatus('주소 검색 중…', true);
      try {
        const result = await provider({ query, kind, page: 1, size: 1, signal: controller.signal });
        if (disposed || token !== generation || controller.signal.aborted) return;
        panel.render(result, kind, () => {
          const item = result.items[0];
          if (item) select(item, token);
        });
      } catch (error) {
        if (disposed || token !== generation || controller.signal.aborted) return;
        panel.setStatus(error instanceof SearchError ? error.message : '검색을 처리하지 못했습니다. 기본 지도는 계속 사용할 수 있습니다.');
      } finally {
        if (active === controller) active = undefined;
      }
    }
    const dispose = () => {
      disposed = true;
      invalidate();
      panel.dispose();
      map.removeLayer(layer);
      source.clear();
      layer.dispose();
      source.dispose();
    };
    try {
      map.addLayer(layer);
      searchHost.append(panel.element);
      if (!vworldApiKey.trim()) panel.setUnavailable('V-World 검색 인증키가 없습니다.');
      else panel.setStatus('');
    } catch (error) { dispose(); throw error; }
    return dispose;
  },
};
