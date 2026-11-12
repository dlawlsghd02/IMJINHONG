import { zoningLayers, type ZoningLayerId } from '../services/vworld/zoningWms';
import { createZoningLegendUrl } from '../services/vworld/zoningLegend';
import { majorLegendNames } from './zoningLegendNames';
import residentialSwatches from '../assets/zoning-swatches/urban-residential.png';
import commercialSwatches from '../assets/zoning-swatches/urban-commercial.png';
import industrialSwatches from '../assets/zoning-swatches/urban-industrial.png';
import greenSwatches from '../assets/zoning-swatches/urban-green.png';
import conservationSwatches from '../assets/zoning-swatches/management-conservation.png';
import productionSwatches from '../assets/zoning-swatches/management-production.png';
import plannedSwatches from '../assets/zoning-swatches/management-planned.png';
import agricultureSwatches from '../assets/zoning-swatches/agriculture-forest.png';
import natureSwatches from '../assets/zoning-swatches/nature-conservation.png';

let legendSequence = 0;

const majorLegendSwatches: Record<ZoningLayerId, readonly string[]> = {
  lt_c_uq111: [residentialSwatches, commercialSwatches, industrialSwatches, greenSwatches],
  lt_c_uq112: [conservationSwatches, productionSwatches, plannedSwatches],
  lt_c_uq113: [agricultureSwatches], lt_c_uq114: [natureSwatches],
};

/** Integrated group legend. No unverified color swatches are generated. */
export function createZoningGroupLegend(id: ZoningLayerId, apiKey: string | undefined, domain: string | undefined, onOpen: () => void) {
  const layer = zoningLayers.find((item) => item.id === id);
  if (!layer) throw new Error('지원하지 않는 범례입니다.');
  const prefix = `zoning-group-${++legendSequence}`;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '범례';
  button.className = 'zoning-legend-group-toggle'; button.id = `${prefix}-button`;
  button.setAttribute('aria-label', `${layer.label} 범례`); button.setAttribute('aria-expanded', 'false');
  const root = document.createElement('section'); root.className = 'zoning-group-body'; root.hidden = true; root.id = `${prefix}-body`;
  button.setAttribute('aria-controls', root.id); root.setAttribute('aria-labelledby', button.id);
  const major = document.createElement('ul'); major.className = 'zoning-major-legend'; major.setAttribute('aria-label', '주요 용도지역');
  majorLegendNames[id].forEach((name, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span'); label.textContent = name;
    const swatches = document.createElement('img'); swatches.className = 'zoning-major-swatches';
    swatches.alt = `${name} 참고 범례의 세부 색상·패턴 견본`;
    swatches.setAttribute('src', majorLegendSwatches[id][index]);
    item.append(label, swatches); major.append(item);
  });
  const notice = document.createElement('p'); notice.className = 'zoning-color-note'; notice.textContent = '제공된 범례 캡처 기반 · 원본 SLD 색상값 미검증';
  const details = document.createElement('button'); details.type = 'button'; details.textContent = '전체 세부 범례'; details.setAttribute('aria-expanded', 'false');
  details.className = 'zoning-details-toggle';
  const body = document.createElement('div'); body.hidden = true; body.id = `${prefix}-details`; details.setAttribute('aria-controls', body.id);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '범례 이미지 불러오는 중…';
  const image = document.createElement('img'); image.alt = `${layer.label} 공식 전체 범례`; image.hidden = true;
  const credit = document.createElement('small'); credit.textContent = '공식 전체 범례 · V-World';
  body.append(status, image, credit); root.append(major, notice, details, body);
  let requested = false, disposed = false;
  const closeDetails = () => {
    if (body.contains(document.activeElement)) details.focus();
    body.hidden = true; details.setAttribute('aria-expanded', 'false');
  };
  const collapse = () => {
    if (root.contains(document.activeElement)) button.focus();
    closeDetails(); root.hidden = true; button.setAttribute('aria-expanded', 'false');
  };
  const clicked = () => {
    if (!root.hidden) { collapse(); return; }
    onOpen(); root.hidden = false; button.setAttribute('aria-expanded', 'true');
  };
  const failed = () => {
    if (disposed) return;
    image.hidden = true; status.hidden = false;
    status.textContent = '범례 이미지를 표시할 수 없습니다. 인증·네트워크·응답 형식을 확인하세요. 이미지 오류만으로 원인을 구분할 수 없습니다.';
  };
  const loaded = () => {
    if (disposed) return;
    if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
    image.hidden = false; status.hidden = true;
  };
  const detailsClicked = () => {
    if (!body.hidden) { closeDetails(); return; }
    body.hidden = false; details.setAttribute('aria-expanded', 'true');
    if (requested) return;
    requested = true;
    try { image.src = createZoningLegendUrl(id, apiKey ?? '', domain); }
    catch { status.textContent = '범례 인증 설정을 확인하세요.'; }
  };
  button.addEventListener('click', clicked); details.addEventListener('click', detailsClicked);
  image.addEventListener('load', loaded); image.addEventListener('error', failed);
  return { root, button, collapse, dispose() {
    disposed = true; button.removeEventListener('click', clicked); details.removeEventListener('click', detailsClicked);
    image.removeEventListener('load', loaded); image.removeEventListener('error', failed);
    if (requested && apiKey) image.removeAttribute('src');
    root.remove(); button.remove();
  } };
}

export function createZoningLegend(apiKey: string, domain: string | undefined, onExpand: () => void) {
  const prefix = `zoning-legend-${++legendSequence}`;
  const root = document.createElement('div'); root.className = 'zoning-legend'; root.hidden = true;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '범례';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section'); panel.className = 'zoning-legend-panel'; panel.hidden = true;
  panel.id = `${prefix}-panel`; toggle.setAttribute('aria-controls', panel.id);
  panel.setAttribute('aria-label', '용도지역 공식 범례');
  const content = document.createElement('div');
  const credit = document.createElement('small'); credit.textContent = '공식 범례 · V-World';
  panel.append(content, credit); root.append(toggle, panel);
  const entries = new Map<ZoningLayerId, { section: HTMLElement; button: HTMLButtonElement; body: HTMLElement; cleanup: () => void }>();
  const closeGroups = () => {
    for (const entry of entries.values()) {
      if (entry.body.contains(document.activeElement)) entry.button.focus();
      entry.body.hidden = true; entry.button.setAttribute('aria-expanded', 'false');
    }
  };
  let expanded = false, enabled = false, disposed = false;
  let selected: readonly ZoningLayerId[] = [];
  const render = () => {
    root.hidden = !enabled || !selected.length;
    panel.hidden = root.hidden || !expanded;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) closeGroups();
    for (const [id, entry] of entries) {
      if (!selected.includes(id)) {
        if (entry.section.contains(document.activeElement)) toggle.focus();
        entry.body.hidden = true; entry.button.setAttribute('aria-expanded', 'false');
      }
      entry.section.hidden = !selected.includes(id);
    }
    if (panel.hidden || disposed) return;
    for (const layer of zoningLayers.filter((item) => selected.includes(item.id))) {
      if (entries.has(layer.id)) continue;
      const section = document.createElement('section');
      const title = document.createElement('h3');
      const button = document.createElement('button'); button.type = 'button'; button.textContent = layer.label;
      button.className = 'zoning-legend-group-toggle'; button.setAttribute('aria-expanded', 'false');
      const body = document.createElement('div'); body.hidden = true;
      button.id = `${prefix}-${layer.id}-toggle`; body.id = `${prefix}-${layer.id}-body`;
      button.setAttribute('aria-controls', body.id);
      body.setAttribute('role', 'region'); body.setAttribute('aria-labelledby', button.id);
      title.append(button);
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
      body.append(status, image); section.append(title, body); content.append(section);
      let requested = false;
      const groupClicked = () => {
        const opening = body.hidden;
        closeGroups();
        if (!opening) return;
        body.hidden = false; button.setAttribute('aria-expanded', 'true');
        if (requested) return;
        requested = true;
        try { image.src = createZoningLegendUrl(layer.id, apiKey, domain); }
        catch { status.textContent = '범례 인증 설정을 확인하세요.'; }
      };
      button.addEventListener('click', groupClicked);
      entries.set(layer.id, { section, button, body, cleanup: () => {
        button.removeEventListener('click', groupClicked);
        image.removeEventListener('load', loaded); image.removeEventListener('error', failed); image.removeAttribute('src');
      } });
    }
  };
  const clicked = () => {
    if (expanded && panel.contains(document.activeElement)) toggle.focus();
    expanded = !expanded; if (expanded) onExpand(); render();
  };
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
