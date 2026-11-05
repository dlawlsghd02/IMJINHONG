import type Map from 'ol/Map.js';
import type { BasemapId } from '../services/vworld/config';

export function bindMapControls(root: HTMLElement, map: Map, select: (id: BasemapId) => void) {
  const controller = new AbortController();
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-basemap], [data-zoom]');
  buttons.forEach((button) => { button.disabled = false; });
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const id = button.dataset.basemap;
    if (id === 'base' || id === 'satellite') {
      select(id);
      root.querySelectorAll<HTMLButtonElement>('[data-basemap]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item.dataset.basemap === id));
      });
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
