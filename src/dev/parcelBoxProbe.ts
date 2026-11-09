import { readEnvironment } from '../config/env';
import { createCadastralProvider } from '../services/vworld/cadastral';
import { ParcelError } from '../services/vworld/parcelValidation';

// main/registry에서 import하지 않는 개발 전용 모듈이다. UI·window 전역에는 등록하지 않는다.
let attempted = false;

export async function runManualBoxOnce(box: number[], acknowledgement: 'BOX_MANUAL_ONCE') {
  if (!import.meta.env.DEV) throw new ParcelError('수동 BOX 검증 모듈은 개발 환경에서만 실행할 수 있습니다.');
  if (acknowledgement !== 'BOX_MANUAL_ONCE') throw new ParcelError('수동 BOX 1회 검증의 명시적 확인이 필요합니다.');
  if (attempted) throw new ParcelError('이 개발 페이지의 수동 BOX 검증은 이미 시도했습니다. 재시도하지 않습니다.');
  // 입력·인증 오류도 1회 시도로 소비한다. import만으로는 요청하지 않는다.
  attempted = true;
  const { vworldApiKey, vworldDomain } = readEnvironment();
  const provider = createCadastralProvider(vworldApiKey, vworldDomain);
  const result = await provider.box(box, new AbortController().signal, 'manual-validation');
  // 원본 응답·키·요청 URL·PNU 원문은 반환하거나 로그로 남기지 않는다.
  return {
    returnedFeatures: result.features.length,
    pnuFormatValid: result.features.every((feature) => /^\d{19}$/.test(feature.get('pnu'))),
    geometryTypes: [...new Set(result.features.map((feature) => feature.getGeometry()?.getType()))],
    completeness: result.completeness,
    truncated: result.truncated,
    requestCrs: 'EPSG:4326',
    displayCrs: 'EPSG:3857',
  };
}
