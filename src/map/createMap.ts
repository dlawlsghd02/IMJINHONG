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
  const viewport = map.getViewport();
  const focusForPointer = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const element = event.target;
    if (!viewport || !(element instanceof Element) || !viewport.contains(element)) return;
    // 지도 안의 컨트롤·링크·편집 요소는 원래 포커스와 입력 동작을 유지한다.
    if (element.closest('a, button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], .ol-control, .ol-overlaycontainer-stopevent')) return;
    if (!target.contains(target.ownerDocument.activeElement)) target.focus({ preventScroll: true });
  };
  // OL 10.11의 viewport pointerdown 리스너는 버블 단계에서 DragPan 조건을
  // 검사한다. 상위 target의 캡처 단계에서 먼저 포커스를 부여한다.
  // 이벤트를 취소하거나 다시 발생시키지 않아 클릭/드래그 판별은 OL에 맡긴다.
  target.addEventListener('pointerdown', focusForPointer, { capture: true, passive: true });
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
  return { map, dispose() {
    target.removeEventListener('pointerdown', focusForPointer, true);
    resize.disconnect(); map.setTarget(undefined); map.dispose();
  } };
}
