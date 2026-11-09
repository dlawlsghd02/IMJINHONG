import type Map from 'ol/Map.js';
import type { BasemapId } from '../services/vworld/config';

export function bindMapControls(root: HTMLElement, map: Map, select: (id: BasemapId) => void,
  setNamesEnabled: (enabled: boolean) => void = () => {}) {
  const controller = new AbortController();
  let namesEnabled = true;
  const names = root.querySelector<HTMLButtonElement>('[data-map-names]');
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-basemap], [data-zoom], [data-map-names]');
  buttons.forEach((button) => { button.disabled = false; });
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const id = button.dataset.basemap;
    if (id === 'base' || id === 'satellite') {
      select(id);
      if (names) names.hidden = id !== 'satellite';
      root.querySelectorAll<HTMLButtonElement>('[data-basemap]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item.dataset.basemap === id));
      });
    }
    if (button === names) {
      namesEnabled = !namesEnabled;
      names.setAttribute('aria-pressed', String(namesEnabled));
      setNamesEnabled(namesEnabled);
    }
    if (button.dataset.zoom) {
      const view = map.getView();
      const zoom = view.getZoom();
      if (zoom !== undefined) {
        view.animate({ zoom: Math.min(view.getMaxZoom(), Math.max(view.getMinZoom(), zoom + Number(button.dataset.zoom))), duration: 180 });
      }
    }
  }, { signal: controller.signal });
  return () => { controller.abort(); buttons.forEach((button) => { button.disabled = true; }); };
}
