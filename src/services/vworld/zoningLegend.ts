import { zoningLayers, type ZoningLayerId } from './zoningWms';

/** Contains credentials: use only as an image source, never log or persist. */
export function createZoningLegendUrl(id: ZoningLayerId, apiKey: string, domain?: string): string {
  if (!zoningLayers.some((layer) => layer.id === id)) throw new Error('지원하지 않는 범례입니다.');
  if (!apiKey.trim()) throw new Error('범례 인증 설정이 없습니다.');
  const url = new URL('https://api.vworld.kr/req/image');
  const params = new URLSearchParams({ service: 'image', version: '2.0', request: 'GetLegendGraphic',
    layer: id, style: id, type: 'ALL', format: 'png', key: apiKey.trim() });
  if (domain?.trim()) {
    let valid = false;
    try {
      const value = new URL(domain.trim());
      valid = ['http:', 'https:'].includes(value.protocol) && !!value.hostname
        && !value.username && !value.password && !value.hash && !/\s/.test(domain.trim());
    } catch { /* Never disclose configuration. */ }
    if (!valid) throw new Error('범례 domain 설정 형식을 확인하세요.');
    params.set('domain', domain.trim());
  }
  url.search = params.toString(); return url.toString();
}
