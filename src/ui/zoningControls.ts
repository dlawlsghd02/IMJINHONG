import { createZoningGroupLegend } from './zoningLegend';
import { zoningLayers, type ZoningLayerId } from '../services/vworld/zoningWms';

export function createZoningControls(onChange: (enabled: boolean, ids: ZoningLayerId[]) => void,
  onOpacity: (opacity: number) => void, authentication?: { apiKey: string; domain?: string }) {
  const root = document.createElement('div'); root.className = 'zoning-controls';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '용도지역';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-expanded', 'false');
  const options = document.createElement('fieldset'); options.hidden = true;
  const legend = document.createElement('legend'); legend.textContent = '표시할 용도지역'; options.append(legend);
  const visibilityLabel = document.createElement('label'); visibilityLabel.className = 'zoning-visibility';
  const visibility = document.createElement('input'); visibility.type = 'checkbox'; visibility.setAttribute('role', 'switch');
  const visibilityText = document.createElement('span'); visibilityText.textContent = '용도지역 표시';
  visibilityLabel.append(visibility, visibilityText); options.append(visibilityLabel);
  const groupLegends: ReturnType<typeof createZoningGroupLegend>[] = [];
  const inputs = zoningLayers.map((layer) => {
    const label = document.createElement('label'), input = document.createElement('input'); label.className = 'zoning-kind';
    input.type = 'checkbox'; input.checked = true; input.value = layer.id;
    const text = document.createElement('span'); text.textContent = layer.label;
    const group = createZoningGroupLegend(layer.id, authentication?.apiKey, authentication?.domain, () => {
      groupLegends.forEach((entry) => entry.collapse());
    });
    groupLegends.push(group);
    const row = document.createElement('div'); row.className = 'zoning-group-row';
    label.append(input, text); row.append(label, group.button); options.append(row, group.root); return input;
  });
  const opacityLabel = document.createElement('label'); opacityLabel.className = 'zoning-opacity';
  const opacityText = document.createElement('span'); opacityText.textContent = '불투명도 55%';
  const opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = '0'; opacity.max = '100'; opacity.step = '5'; opacity.value = '55';
  opacityLabel.append(opacityText, opacity); options.append(opacityLabel);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
  root.append(toggle, options, status);
  let enabled = false, expanded = false;
  const mobile = window.matchMedia('(max-width: 900px)');
  const updatePresentation = () => {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', mobile.matches ? `용도지역 ${enabled ? '켜짐' : '꺼짐'}, 설정 ${expanded ? '접기' : '펼치기'}` : '용도지역');
    visibility.checked = enabled;
    // 화면 전환으로 포커스가 숨겨지는 경우에만 버튼으로 돌린다.
    if ((!expanded && options.contains(document.activeElement)) || (!mobile.matches && visibility === document.activeElement)) toggle.focus();
    options.hidden = !expanded;
    if (!expanded || !enabled) groupLegends.forEach((entry) => entry.collapse());
  };
  const selectedIds = () => zoningLayers.filter((_, index) => inputs[index].checked).map((layer) => layer.id);
  const changed = () => { onChange(enabled, selectedIds()); };
  const toggled = () => {
    if (mobile.matches) {
      expanded = !expanded;
      if (expanded && !enabled) { enabled = true; changed(); }
    } else { enabled = !enabled; expanded = enabled; changed(); }
    updatePresentation();
  };
  const visibilityChanged = () => { enabled = visibility.checked; updatePresentation(); changed(); };
  // 화면 회전·너비 변경으로 표시 상태·선택값·요청 설정을 변경하지 않는다.
  const screenChanged = () => {
    updatePresentation();
  };
  const opacityChanged = () => {
    const value = Number(opacity.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    opacityText.textContent = `불투명도 ${value}%`; onOpacity(value / 100);
  };
  toggle.addEventListener('click', toggled); inputs.forEach((input) => input.addEventListener('change', changed)); opacity.addEventListener('input', opacityChanged);
  visibility.addEventListener('change', visibilityChanged); mobile.addEventListener('change', screenChanged);
  updatePresentation();
  return { root, setStatus(message: string, busy = false) {
    status.textContent = message; status.hidden = !message; status.setAttribute('aria-busy', String(busy));
  }, dispose() {
    toggle.removeEventListener('click', toggled); inputs.forEach((input) => input.removeEventListener('change', changed)); opacity.removeEventListener('input', opacityChanged);
    visibility.removeEventListener('change', visibilityChanged); mobile.removeEventListener('change', screenChanged); groupLegends.forEach((entry) => entry.dispose()); root.remove();
  } };
}
