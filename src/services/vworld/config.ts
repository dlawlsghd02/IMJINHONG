export type BasemapId = 'base' | 'satellite';
export type TileLayerId = BasemapId | 'hybrid';

export const vworldConfig = {
  endpoint: 'https://api.vworld.kr/req/wmts/1.0.0',
  attribution: '© <a href="https://www.vworld.kr/" target="_blank" rel="noopener noreferrer">V-World</a>',
};

// WMTS REST 경로: TileMatrix(z) / TileRow(y) / TileCol(x).
// 공식 문서 재확인 및 실제 키 응답 검증은 3단계에서 수행한다.
export const basemapDefinitions = {
  base: { label: '일반지도', layer: 'Base', extension: 'png', maxZoom: 19 },
  satellite: { label: '위성지도', layer: 'Satellite', extension: 'jpeg', maxZoom: 18 },
  hybrid: { label: '위성지도 명칭', layer: 'Hybrid', extension: 'png', maxZoom: 18 },
} as const;
