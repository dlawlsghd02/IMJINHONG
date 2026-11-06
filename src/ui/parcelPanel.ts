import { cadastralSource } from '../services/vworld/cadastral';
import { landLedgerSource } from '../services/vworld/landLedger';
import type { LandLedger } from '../services/vworld/landLedger';
import { landPriceSource } from '../services/vworld/landPrice';
import type { LandPrice } from '../services/vworld/landPrice';
import type { AttributeState } from '../services/vworld/parcelValidation';

export function createParcelPanel(onToggle: () => void, onClose: () => void) {
  const controls = document.createElement('div');
  controls.className = 'parcel-controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '지적도 켜기';
  toggle.setAttribute('aria-pressed', 'false');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = '지적도 꺼짐';
  controls.append(toggle, status);
  const panel = document.createElement('section');
  panel.className = 'parcel-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '선택 필지 상세정보');
  const heading = document.createElement('div');
  heading.className = 'parcel-panel-heading';
  const title = document.createElement('h2');
  title.textContent = '필지 상세정보';
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '닫기';
  heading.append(title, close);
  const base = document.createElement('dl');
  const ledger = document.createElement('div');
  const price = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'parcel-note';
  note.textContent = '연속지적도는 참고용입니다. 공부상 면적과 도형 계산면적은 다르며, 개별공시지가는 원/㎡ 단가로 전체 토지가격·거래가격이 아닙니다.';
  panel.append(heading, base, ledger, price, note);
  toggle.addEventListener('click', onToggle);
  close.addEventListener('click', onClose);
  const field = (list: HTMLElement, label: string, value: string) => {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value;
    list.append(term, description);
  };
  const source = (host: HTMLElement, label: string, href: string) => {
    const link = document.createElement('a');
    link.textContent = label; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    host.append(link);
  };
  const message = (host: HTMLElement, value: string) => {
    host.replaceChildren();
    const paragraph = document.createElement('p'); paragraph.textContent = value; host.append(paragraph);
  };
  return {
    controls, panel,
    setEnabled(enabled: boolean) {
      toggle.textContent = enabled ? '지적도 끄기' : '지적도 켜기';
      toggle.setAttribute('aria-pressed', String(enabled));
    },
    setStatus(value: string, busy = false) { status.textContent = value; controls.setAttribute('aria-busy', String(busy)); },
    clear() { panel.hidden = true; base.replaceChildren(); ledger.replaceChildren(); price.replaceChildren(); },
    showSelection(id: string, jibun: string | null) {
      panel.hidden = false;
      base.replaceChildren();
      field(base, 'PNU', id); field(base, '지번', jibun ?? '미제공');
      field(base, '지적 자료 기준시점', '응답에 미제공');
      source(base, 'V-World 연속지적도', cadastralSource);
      message(ledger, '토지임야 속성 조회 준비 중…'); message(price, '개별공시지가 조회 준비 중…');
    },
    renderLedger(state: AttributeState<LandLedger>) {
      ledger.replaceChildren();
      if (state.status === 'ok') {
        const list = document.createElement('dl'), value = state.value;
        field(list, '지목', value.landCategoryCode ? `${value.landCategoryName ?? '명칭 미제공'} (코드 ${value.landCategoryCode})` : '미확인');
        field(list, '공부상 면적', value.registeredArea === null ? '미제공' : `${value.registeredArea.toLocaleString('ko-KR')} ㎡`);
        field(list, '토지임야 갱신일', value.updatedAt ?? '미제공'); ledger.append(list);
      } else message(ledger, state.message);
      source(ledger, '국토교통부 토지임야 속성', landLedgerSource);
    },
    renderPrice(state: AttributeState<LandPrice>) {
      price.replaceChildren();
      if (state.status === 'ok') {
        const list = document.createElement('dl'), value = state.value;
        field(list, '개별공시지가', value.pricePerSquareMeter === null ? '미제공' : `${value.pricePerSquareMeter.toLocaleString('ko-KR')} 원/㎡`);
        field(list, '기준연월', `${value.year}년 ${value.month ? `${value.month}월` : '(월 미제공)'}`);
        field(list, '공시일자', value.publishedAt ?? '미제공');
        field(list, '공시지가 갱신일', value.updatedAt ?? '미제공'); price.append(list);
      } else message(price, state.message);
      source(price, '국토교통부 개별공시지가 속성', landPriceSource);
    },
    dispose() { toggle.removeEventListener('click', onToggle); close.removeEventListener('click', onClose); controls.remove(); panel.remove(); },
  };
}
