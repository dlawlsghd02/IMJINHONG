import 'ol/ol.css';
import './styles/base.css';
import './styles/map.css';
import { readEnvironment } from './config/env';
import { createBasemaps } from './map/basemaps';
import { createMap } from './map/createMap';
import { createLayout } from './ui/layout';
import { bindMapControls } from './ui/mapControls';
import { bindCoordinateDisplay } from './ui/coordinateDisplay';
import { basemapDefinitions } from './services/vworld/config';
import { features } from './features/registry';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('앱 컨테이너가 없습니다.');
const ui = createLayout(root);
const cleanup: Array<() => void> = [];
let stage: 'configuration' | 'initialization' = 'configuration';

try {
  const { vworldApiKey } = readEnvironment();
  stage = 'initialization';
  const basemaps = createBasemaps(vworldApiKey, ({ id, pending, failures }) => {
    ui.retry.hidden = failures === 0;
    ui.status.dataset.state = failures ? 'error' : 'normal';
    const label = basemapDefinitions[id].label;
    ui.status.textContent = failures
      ? `${label}: 타일 요청 ${failures}건 실패. 인증키·등록 서비스 URL·네트워크·제공 범위를 확인하세요. 원인은 개발자 도구 Network에서 확인할 수 있습니다.`
      : pending ? `${label} 타일 불러오는 중…` : `${label} · 타일 요청 오류 없음`;
  });
  cleanup.push(() => basemaps.dispose());
  const instance = createMap(ui.target, basemaps.layers);
  cleanup.push(() => instance.dispose());
  cleanup.push(bindMapControls(root, instance.map, (id) => basemaps.select(id)));
  cleanup.push(bindCoordinateDisplay(instance.map, ui.basis, ui.coordinates));
  features.forEach((feature) => cleanup.push(feature.mount({ map: instance.map })));
  const retry = () => basemaps.retry();
  ui.retry.addEventListener('click', retry);
  cleanup.push(() => ui.retry.removeEventListener('click', retry));
  ui.status.textContent = '일반지도 타일 요청 대기 중…';
} catch (error) {
  cleanup.reverse().forEach((dispose) => dispose());
  cleanup.length = 0;
  ui.status.dataset.state = 'error';
  ui.status.textContent = stage === 'configuration' && error instanceof Error
    ? `설정 오류: ${error.message}`
    : '지도 초기화 오류: 브라우저 지원 및 설치된 의존성을 확인하세요. 지도 초기화에 실패했습니다.';
  // 요청 URL 또는 인증키를 콘솔에 기록하지 않는다.
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => { cleanup.reverse().forEach((dispose) => dispose()); });
}
