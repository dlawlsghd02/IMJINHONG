import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { unByKey } from 'ol/Observable.js';
import type { EventsKey } from 'ol/events.js';
import { basemapDefinitions, vworldConfig } from '../services/vworld/config';
import type { BasemapId } from '../services/vworld/config';
import { createTileUrl } from '../services/vworld/tileUrl';

export interface TileStatus {
  id: BasemapId;
  pending: number;
  failures: number;
}

export function createBasemaps(apiKey: string, onStatus: (status: TileStatus) => void,
  onHybridStatus: (failures: number) => void = () => {}) {
  let active: BasemapId = 'base';
  let namesEnabled = true, hybridFailures = 0;
  const states = {
    base: { id: 'base', pending: 0, failures: 0 } as TileStatus,
    satellite: { id: 'satellite', pending: 0, failures: 0 } as TileStatus,
  };
  const keys: EventsKey[] = [];
  const layers = (['base', 'satellite'] as const).map((id) => {
    const source = new XYZ({
      url: createTileUrl(id, apiKey),
      projection: 'EPSG:3857',
      minZoom: 5,
      maxZoom: basemapDefinitions[id].maxZoom,
      attributions: vworldConfig.attribution,
      wrapX: false,
    });
    const notify = () => { if (id === active) onStatus({ ...states[id] }); };
    keys.push(source.on('tileloadstart', () => { states[id].pending++; notify(); }));
    keys.push(source.on('tileloadend', () => {
      states[id].pending = Math.max(0, states[id].pending - 1);
      notify();
    }));
    keys.push(source.on('tileloaderror', () => {
      states[id].pending = Math.max(0, states[id].pending - 1);
      states[id].failures++;
      notify();
    }));
    return new TileLayer({ source, visible: id === active });
  });

  // Shared XYZ grid with Satellite. Limit native zoom to the existing imagery range.
  const hybridSource = new XYZ({ url: createTileUrl('hybrid', apiKey), projection: 'EPSG:3857',
    minZoom: 5, maxZoom: basemapDefinitions.hybrid.maxZoom, wrapX: false, attributions: vworldConfig.attribution });
  const hybrid = new TileLayer({ source: hybridSource, visible: false });
  hybrid.setZIndex(30);
  const updateHybrid = () => {
    const visible = active === 'satellite' && namesEnabled;
    hybrid.setVisible(visible); onHybridStatus(visible ? hybridFailures : 0);
  };
  keys.push(hybridSource.on('tileloaderror', () => {
    hybridFailures++;
    if (active === 'satellite' && namesEnabled) onHybridStatus(hybridFailures);
  }));
  return {
    layers: [...layers, hybrid],
    select(id: BasemapId) {
      active = id;
      layers.forEach((layer, index) => layer.setVisible(index === (id === 'base' ? 0 : 1)));
      updateHybrid();
      onStatus({ ...states[id] });
    },
    setNamesEnabled(enabled: boolean) { namesEnabled = enabled; updateHybrid(); },
    retry() {
      states[active].failures = 0;
      states[active].pending = 0;
      layers[active === 'base' ? 0 : 1].getSource()?.refresh();
      onStatus({ ...states[active] });
    },
    dispose() { keys.forEach((key) => unByKey(key)); },
  };
}
