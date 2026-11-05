import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { transformExtent } from 'ol/proj.js';
import type TileLayer from 'ol/layer/Tile.js';
import type XYZ from 'ol/source/XYZ.js';
import { mapConfig } from '../config/map';

export function createMap(target: HTMLElement, layers: TileLayer<XYZ>[]) {
  const view = new View({
    projection: mapConfig.viewProjection,
    center: [0, 0],
    zoom: mapConfig.minZoom,
    minZoom: mapConfig.minZoom,
    maxZoom: mapConfig.maxZoom,
  });
  const map = new Map({
    target, layers, view,
    controls: defaultControls({ zoom: false, rotate: false, attributionOptions: { collapsible: false } }),
  });
  let fitted = false;
  const resize = new ResizeObserver(() => {
    map.updateSize();
    const size = map.getSize();
    if (!fitted && size && size[0] > 0 && size[1] > 0) {
      view.fit(transformExtent(mapConfig.initialExtent, mapConfig.displayProjection, mapConfig.viewProjection), {
        size, padding: Array(4).fill(mapConfig.initialPadding),
      });
      fitted = true;
    }
  });
  resize.observe(target);
  return { map, dispose() { resize.disconnect(); map.setTarget(undefined); map.dispose(); } };
}
