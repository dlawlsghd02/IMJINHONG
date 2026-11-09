import TileLayer from 'ol/layer/Tile.js';
import { unByKey } from 'ol/Observable.js';
import type { EventsKey } from 'ol/events.js';
import type { MapFeature } from './types';
import { createZoningSource, zoningParameters } from '../services/vworld/zoningWms';
import { createZoningControls } from '../ui/zoningControls';

export const zoningFeature: MapFeature = {
  id: 'zoning',
  mount({ map, zoningHost, vworldApiKey, vworldDomain }) {
    const source = createZoningSource(vworldApiKey, vworldDomain);
    const layer = new TileLayer({ source, visible: false, opacity: 0.55 });
    // 배경지도 위, 지적 경계(40)·선택 강조(50) 아래에 배치한다.
    layer.setZIndex(20);
    let active = false, failures = 0;
    const pending = new Set<unknown>();
    const notify = () => {
      if (!active) return;
      ui.setStatus(failures ? `용도지역: 표시 시작 이후 타일 ${failures}건 실패. 인증·네트워크를 확인하세요.` : pending.size ? '용도지역 불러오는 중…' : '용도지역 · 타일 요청 오류 없음', pending.size > 0);
    };
    const ui = createZoningControls((enabled, ids) => {
      active = enabled && ids.length > 0;
      layer.setVisible(false); pending.clear(); failures = 0;
      if (active) source.updateParams(zoningParameters(ids));
      layer.setVisible(active);
      ui.setStatus(!enabled ? '' : !ids.length ? '표시할 용도지역을 선택하세요.' : '용도지역 타일 요청 대기 중…');
    }, (opacity) => layer.setOpacity(opacity));
    const current = (tile: { getKey(): string }) => active && tile.getKey().startsWith(source.getKey() + '/');
    const keys: EventsKey[] = [
      source.on('tileloadstart', ({ tile }) => { if (current(tile)) { pending.add(tile); notify(); } }),
      source.on('tileloadend', ({ tile }) => { if (current(tile)) { pending.delete(tile); notify(); } }),
      source.on('tileloaderror', ({ tile }) => { if (current(tile)) { pending.delete(tile); failures++; notify(); } }),
    ];
    const dispose = () => { active = false; unByKey(keys); pending.clear(); ui.dispose(); map.removeLayer(layer); layer.dispose(); source.dispose(); };
    try { map.addLayer(layer); zoningHost.append(ui.root); }
    catch (error) { dispose(); throw error; }
    return dispose;
  },
};
