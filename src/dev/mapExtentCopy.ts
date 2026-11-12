import type Map from 'ol/Map.js';

/** 허용한 지도 메타데이터만 직렬화한다. 레이어·피처·인증 설정은 읽지 않는다. */
export function mapExtentText(map: Pick<Map, 'getView' | 'getSize'>): string {
  const view = map.getView(), size = map.getSize(), zoom = view.getZoom();
  if (!size || size.length !== 2 || size.some(n => !Number.isFinite(n) || n <= 0)
    || zoom === undefined || !Number.isFinite(zoom)) throw Error('지도 범위 미확인');
  const bbox = view.calculateExtent(size);
  if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n))
    || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw Error('지도 범위 미확인');
  return JSON.stringify({ crs: view.getProjection().getCode(), bbox, size, zoom }, null, 2);
}

export function mountMapExtentCopy(map: Map, host: HTMLElement): () => void {
  const container = document.createElement('div');
  const button = document.createElement('button');
  button.type = 'button';
  button.style.pointerEvents = 'auto';
  button.textContent = '지도 범위 복사';
  button.title = '개발 전용 · CRS, BBOX, 지도 화면 크기, zoom만 복사';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  let disposed = false;
  const copy = async () => {
    try {
      const text = mapExtentText(map);
      if (!navigator.clipboard?.writeText) throw Error('클립보드 사용 불가');
      await navigator.clipboard.writeText(text);
      if (!disposed) status.textContent = '지도 범위 복사 완료';
    } catch {
      if (!disposed) status.textContent = '복사 실패 · 지도 준비 상태와 클립보드 권한을 확인하세요.';
    }
  };
  button.addEventListener('click', copy);
  container.append(button, status);
  host.append(container);
  return () => { disposed = true; button.removeEventListener('click', copy); container.remove(); };
}
