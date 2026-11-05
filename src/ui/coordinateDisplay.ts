import type Map from 'ol/Map.js';
import { unByKey } from 'ol/Observable.js';
import { formatCoordinates } from '../map/coordinates';

export function bindCoordinateDisplay(map: Map, basis: HTMLElement, output: HTMLElement) {
  const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let lastPointer: number[] | undefined;
  const center = () => {
    const coordinate = map.getView().getCenter();
    if (coordinate) output.textContent = formatCoordinates(coordinate);
  };
  const reset = () => {
    lastPointer = undefined;
    basis.textContent = pointer.matches ? '지도 중심 · 포인터 진입 대기' : '지도 중심';
    center();
  };
  const keys = [
    map.on('pointermove', (event) => {
      if (!pointer.matches || event.dragging) return;
      lastPointer = event.pixel;
      basis.textContent = '마우스 포인터';
      output.textContent = formatCoordinates(event.coordinate);
    }),
    map.on('moveend', () => {
      if (pointer.matches && lastPointer) {
        output.textContent = formatCoordinates(map.getCoordinateFromPixel(lastPointer));
      } else center();
    }),
  ];
  const viewport = map.getViewport();
  viewport?.addEventListener('pointerleave', reset);
  pointer.addEventListener('change', reset);
  reset();
  return () => {
    keys.forEach((key) => unByKey(key));
    viewport?.removeEventListener('pointerleave', reset);
    pointer.removeEventListener('change', reset);
  };
}
