import { zoningLayers, type ZoningLayerId } from '../services/vworld/zoningWms';
import { createZoningLegendUrl } from '../services/vworld/zoningLegend';

export function createZoningLegend(apiKey: string, domain: string | undefined, onExpand: () => void) {
  const root = document.createElement('div'); root.className = 'zoning-legend'; root.hidden = true;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '범례';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section'); panel.className = 'zoning-legend-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '용도지역 공식 범례');
  const content = document.createElement('div');
  const credit = document.createElement('small'); credit.textContent = '공식 범례 · V-World';
  panel.append(content, credit); root.append(toggle, panel);
  const entries = new Map<ZoningLayerId, { section: HTMLElement; cleanup: () => void }>();
  let expanded = false, enabled = false, disposed = false;
  let selected: readonly ZoningLayerId[] = [];
  const render = () => {
    root.hidden = !enabled || !selected.length;
    panel.hidden = root.hidden || !expanded;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    for (const [id, entry] of entries) entry.section.hidden = !selected.includes(id);
    if (panel.hidden || disposed) return;
    for (const layer of zoningLayers.filter((item) => selected.includes(item.id))) {
      if (entries.has(layer.id)) continue;
      const section = document.createElement('section');
      const title = document.createElement('h3'); title.textContent = layer.label;
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '범례 이미지 불러오는 중…';
      const image = document.createElement('img'); image.alt = `${layer.label} 공식 범례`; image.hidden = true;
      // Plain image loading; no unverified CORS/fetch fallback or automatic retry.
      const failed = () => {
        if (disposed) return;
        image.hidden = true; status.hidden = false;
        status.textContent = '범례 이미지를 표시할 수 없습니다. 인증·네트워크·응답 형식을 확인하세요. 이미지 오류만으로 원인을 구분할 수 없습니다.';
      };
      const loaded = () => {
        if (disposed) return;
        if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
        status.hidden = true; image.hidden = false;
      };
      image.addEventListener('load', loaded); image.addEventListener('error', failed);
      section.append(title, status, image); content.append(section);
      entries.set(layer.id, { section, cleanup: () => {
        image.removeEventListener('load', loaded); image.removeEventListener('error', failed); image.removeAttribute('src');
      } });
      try { image.src = createZoningLegendUrl(layer.id, apiKey, domain); }
      catch { status.textContent = '범례 인증 설정을 확인하세요.'; }
    }
  };
  const clicked = () => { expanded = !expanded; if (expanded) onExpand(); render(); };
  toggle.addEventListener('click', clicked);
  return { root, setState(nextEnabled: boolean, ids: readonly ZoningLayerId[]) {
    enabled = nextEnabled; selected = ids;
    if (!enabled || !ids.length) expanded = false;
    render();
  }, collapse() {
    if (panel.contains(document.activeElement)) toggle.focus();
    expanded = false; render();
  }, dispose() {
    disposed = true; toggle.removeEventListener('click', clicked);
    for (const entry of entries.values()) entry.cleanup();
    entries.clear(); root.remove();
  } };
}
