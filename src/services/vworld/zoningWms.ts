import TileWMS from 'ol/source/TileWMS.js';

export const zoningLayers = [
  { id: 'lt_c_uq111', label: '도시지역' },
  { id: 'lt_c_uq112', label: '관리지역' },
  { id: 'lt_c_uq113', label: '농림지역' },
  { id: 'lt_c_uq114', label: '자연환경보전지역' },
] as const;
export type ZoningLayerId = typeof zoningLayers[number]['id'];

export function zoningParameters(ids: readonly ZoningLayerId[]) {
  if (new Set(ids).size !== ids.length || ids.some((id) => !zoningLayers.some((layer) => layer.id === id))) {
    throw new Error('지원하지 않는 용도지역 레이어입니다.');
  }
  return { LAYERS: ids.join(','), STYLES: ids.join(',') };
}

export function createZoningSource(apiKey: string, domain?: string) {
  if (!apiKey.trim()) throw new Error('용도지역 인증 설정이 없습니다.');
  const authentication: Record<string, string> = { KEY: apiKey.trim() };
  if (domain?.trim()) {
    let valid = false;
    try {
      const url = new URL(domain.trim());
      valid = ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash && !/\s/.test(domain.trim());
    } catch { /* 설정 원문은 출력하지 않는다. */ }
    if (!valid) throw new Error('용도지역 domain 설정 형식을 확인하세요.');
    authentication.DOMAIN = domain.trim();
  }
  return new TileWMS({
    url: 'https://api.vworld.kr/req/wms',
    projection: 'EPSG:3857',
    params: { VERSION: '1.3.0', FORMAT: 'image/png', TRANSPARENT: true,
      ...zoningParameters(zoningLayers.map((layer) => layer.id)), ...authentication },
    // CORS 응답 헤더 미확인: crossOrigin을 지정하지 않고 일반 이미지로 표시한다.
    // 지도 이미지 내보내기·픽셀 읽기는 지원을 보장하지 않는다.
    wrapX: false,
    attributions: '용도지역: 국토교통부 · V-World',
  });
}
