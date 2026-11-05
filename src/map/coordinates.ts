import { transform } from 'ol/proj.js';
import type { Coordinate } from 'ol/coordinate.js';
import { mapConfig } from '../config/map';

export function formatCoordinates(coordinate: Coordinate): string {
  const [longitude, latitude] = transform(coordinate, mapConfig.viewProjection, mapConfig.displayProjection);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return '좌표 확인 불가';
  const wrappedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  return `경도 ${wrappedLongitude.toFixed(5)}° · 위도 ${latitude.toFixed(5)}°`;
}
