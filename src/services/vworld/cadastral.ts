import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import { containsExtent } from 'ol/extent.js';
import { get as getProjection } from 'ol/proj.js';
import { getArea } from 'ol/sphere.js';
import { parcelConfig } from '../../config/parcel';
import { integer, object, ParcelError, pnu, text } from './parcelValidation';
import { requestCadastralJsonp } from './cadastralJsonp';

export type ParcelGeometry = Polygon | MultiPolygon;
export type ParcelFeature = Feature<ParcelGeometry>;
export interface ParcelBatch { features: ParcelFeature[]; truncated: boolean }
export const cadastralSource = 'https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral';

// 공식 연속지적도 레퍼런스에서 확인한 코드만 허용한다.
// 표시할 코드와 안내도 고정 문자열로 작성하며 서버 error.text는 사용하지 않는다.
const confirmedApiErrorMessages: ReadonlyMap<string, string> = new Map([
  ['PARAM_REQUIRED', 'PARAM_REQUIRED: 필수 요청값 누락'],
  ['INVALID_TYPE', 'INVALID_TYPE: 요청값 형식 오류'],
  ['INVALID_RANGE', 'INVALID_RANGE: 요청값 허용 범위 초과'],
  ['INVALID_KEY', 'INVALID_KEY: 등록되지 않은 인증키'],
  ['INCORRECT_KEY', 'INCORRECT_KEY: 인증정보 불일치 또는 등록 도메인 불일치'],
  ['UNAVAILABLE_KEY', 'UNAVAILABLE_KEY: 인증키 일시 사용 불가'],
  ['OVER_REQUEST_LIMIT', 'OVER_REQUEST_LIMIT: 요청 한도 초과'],
  ['SYSTEM_ERROR', 'SYSTEM_ERROR: 서버 시스템 오류'],
  ['UNKNOWN_ERROR', 'UNKNOWN_ERROR: 서버에서 원인을 분류하지 못한 오류'],
]);

function longitudeLatitude(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === 'number' && Number.isFinite(item)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 85.05112878) throw new ParcelError('지적 좌표가 표시 가능한 경위도 범위를 벗어났습니다.');
  return [value[0], value[1]];
}

function geometry(value: unknown): ParcelGeometry {
  const raw = object(value);
  let vertices = 0;
  const ring = (value: unknown): number[][] => {
    if (!Array.isArray(value) || value.length < 4) throw new ParcelError('지적 경계의 링이 올바르지 않습니다.');
    const result = value.map((position) => {
      if (++vertices > 100_000) throw new ParcelError('필지 꼭짓점 수가 상한을 초과했습니다.');
      return longitudeLatitude(position);
    });
    const first = result[0], last = result[result.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new ParcelError('닫히지 않은 필지 경계입니다.');
    return result;
  };
  const polygon = (value: unknown): number[][][] => {
    if (!Array.isArray(value) || !value.length) throw new ParcelError('비어 있는 필지 도형입니다.');
    return value.map(ring);
  };
  let result: ParcelGeometry;
  if (raw.type === 'Polygon') result = new Polygon(polygon(raw.coordinates));
  else if (raw.type === 'MultiPolygon' && Array.isArray(raw.coordinates) && raw.coordinates.length) result = new MultiPolygon(raw.coordinates.map(polygon));
  else throw new ParcelError('Polygon 또는 MultiPolygon 응답이 아닙니다.');
  result.transform('EPSG:4326', 'EPSG:3857');
  const extent = getProjection('EPSG:3857')?.getExtent();
  if (!result.getExtent().every(Number.isFinite) || !extent || !containsExtent(extent, result.getExtent())) throw new ParcelError('지적 도형 좌표변환에 실패했습니다.');
  return result;
}

function checkCrs(value: unknown) {
  if (value === undefined || value === null) return;
  const name = typeof value === 'string' ? value : object(object(value).properties).name;
  if (name !== 'EPSG:4326' && name !== 'urn:ogc:def:crs:EPSG::4326') throw new ParcelError('지적 응답 좌표계가 EPSG:4326과 다릅니다.');
}

export function parseCadastral(payload: unknown, limit: number): ParcelBatch {
  const response = object(object(payload).response);
  // 원문 오류 메시지는 키/URL을 포함할 수 있으므로 표시하거나 기록하지 않는다.
  if (response.status === 'NOT_FOUND') return { features: [], truncated: false };
  if (response.status === 'ERROR') {
    const error = response.error;
    const code = error && typeof error === 'object' && !Array.isArray(error) ? object(error).code : undefined;
    const knownMessage = typeof code === 'string' ? confirmedApiErrorMessages.get(code) : undefined;
    throw new ParcelError(knownMessage ?? '지적 API 서버가 오류를 반환했습니다. 서버 오류 코드는 미확인 또는 허용 목록 밖이므로 표시하지 않습니다.', 'api');
  }
  if (response.status !== 'OK') throw new ParcelError('지적 API의 상태값이 예상과 다릅니다. 상태 원문은 표시하지 않습니다.', 'unexpected-status');
  const result = object(response.result), collection = object(result.featureCollection);
  checkCrs(result.crs); checkCrs(collection.crs);
  // 실증 응답은 crs 필드가 없었다. 고정 서비스의 명시적 crs 요청과 검증된 x/y 순서를 사용한다.
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length > limit) throw new ParcelError('지적 응답 형식 또는 건수 상한이 올바르지 않습니다.');
  const record = object(response.record), page = object(response.page);
  const count = integer(record.current), total = integer(record.total);
  if (count !== collection.features.length || total < count || integer(page.current) !== 1 || integer(page.size) !== limit || integer(page.total) < (total ? 1 : 0)) throw new ParcelError('지적 응답 건수·페이지 정보가 일치하지 않습니다.');
  const unique = new Map<string, ParcelFeature>();
  for (const raw of collection.features) {
    const row = object(raw), properties = object(row.properties);
    if (row.type !== 'Feature') throw new ParcelError('지적 Feature 형식이 아닙니다.');
    const id = pnu(properties.pnu);
    const feature = new Feature<ParcelGeometry>({ geometry: geometry(row.geometry), pnu: id, jibun: text(properties.jibun) });
    feature.setId(id);
    if (unique.has(id)) throw new ParcelError('동일 PNU 도형이 중복되어 자동 선택할 수 없습니다.');
    unique.set(id, feature);
  }
  return { features: [...unique.values()], truncated: total > count || integer(page.total) > 1 };
}

export function validateParcelBox(box: number[]): void {
  if (box.length !== 4) throw new ParcelError('조회 범위가 올바르지 않습니다.');
  longitudeLatitude(box.slice(0, 2)); longitudeLatitude(box.slice(2, 4));
  const [west, south, east, north] = box;
  if (west >= east || south >= north || east - west > 180) throw new ParcelError('역전되거나 날짜변경선을 넘는 범위는 조회하지 않습니다.');
  const area = getArea(new Polygon([[[west, south], [east, south], [east, north], [west, north], [west, south]]]), { projection: 'EPSG:4326' });
  if (!Number.isFinite(area) || area > parcelConfig.maxAreaSquareMeters) throw new ParcelError('화면 범위가 0.25㎢를 초과합니다. 더 확대하세요.');
}

export function createCadastralProvider(apiKey: string) {
  async function request(filter: string, limit: number, signal: AbortSignal) {
    if (!apiKey.trim()) throw new ParcelError('V-World 지적 인증키가 없습니다.');
    const parameters = new URLSearchParams({ service: 'data', version: '2.0', request: 'GetFeature',
      data: 'LP_PA_CBND_BUBUN', key: apiKey.trim(), format: 'json', errorFormat: 'json', crs: 'EPSG:4326',
      geomFilter: filter, geometry: 'true', attribute: 'true', columns: 'pnu,jibun', page: '1', size: String(limit) });
    const payload = await requestCadastralJsonp(parameters, signal);
    if (signal.aborted) throw new DOMException('Invalidated', 'AbortError');
    return parseCadastral(payload, limit);
  }
  return {
    point(coordinate: number[], signal: AbortSignal) {
      const [longitude, latitude] = longitudeLatitude(coordinate);
      return request(`POINT(${longitude} ${latitude})`, parcelConfig.pointResultLimit, signal);
    },
    box(box: number[], signal: AbortSignal) {
      if (!parcelConfig.autoBoundaryQueryEnabled) throw new ParcelError('BOX 조회는 실제 검증 전 비활성화되어 있습니다.');
      validateParcelBox(box);
      return request(`BOX(${box[0]},${box[1]},${box[2]},${box[3]})`, parcelConfig.maxFeatures, signal);
    },
  };
}
