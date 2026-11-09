import type { LandLedger } from '../services/vworld/landLedger';
import type { LandPriceBatch } from '../services/vworld/landPrice';
import type { AttributeState } from '../services/vworld/parcelValidation';
import type { PriceHistorySnapshot } from '../features/landPriceHistory';

export function createParcelPanel(onToggle: () => void, onClose: () => void) {
  const controls = document.createElement('div');
  controls.className = 'parcel-controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'parcel-toggle';
  const icon = document.createElement('span'); icon.className = 'parcel-layer-icon'; icon.setAttribute('aria-hidden', 'true');
  const toggleLabel = document.createElement('span'); toggleLabel.textContent = '지적도';
  const toggleState = document.createElement('span'); toggleState.className = 'parcel-toggle-state'; toggleState.textContent = 'OFF';
  toggle.append(icon, toggleLabel, toggleState);
  toggle.setAttribute('aria-label', '지적도 켜기');
  toggle.setAttribute('aria-pressed', 'false');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  const boundaryStatus = document.createElement('p');
  boundaryStatus.setAttribute('role', 'status');
  boundaryStatus.setAttribute('aria-live', 'polite');
  boundaryStatus.hidden = true;
  controls.append(toggle, status, boundaryStatus);
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
  const base = document.createElement('div'); base.className = 'parcel-identity';
  const ledger = document.createElement('div');
  ledger.className = 'parcel-facts-host';
  const price = document.createElement('div');
  price.className = 'parcel-prices'; // 향후 연도별 이력을 별도 섹션으로 추가할 수 있는 독립 영역
  const history = document.createElement('details'); history.className = 'parcel-price-history'; history.hidden = true;
  const historyTitle = document.createElement('summary'); historyTitle.textContent = '연도별 공시지가 이력';
  const historyContent = document.createElement('div'); history.append(historyTitle, historyContent);
  let requestedYear: string | undefined;
  const note = document.createElement('p');
  note.className = 'parcel-note';
  note.textContent = '개별공시지가는 원/㎡ 단가이며 전체 토지가격이나 실거래가가 아닙니다.';
  panel.append(heading, base, ledger, price, history, note);
  toggle.addEventListener('click', onToggle);
  close.addEventListener('click', onClose);
  const field = (list: HTMLElement, label: string, value: string) => {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = label; description.textContent = value;
    list.append(term, description);
  };
  const message = (host: HTMLElement, value: string) => {
    host.replaceChildren();
    const paragraph = document.createElement('p'); paragraph.textContent = value; host.append(paragraph);
  };
  // 기존 산출값에 표시 색상만 부여하며 데이터와 계산은 변경하지 않는다.
  const rateClass = (rate: string) => rate.startsWith('+') ? 'price-rise' : rate.startsWith('-') ? 'price-fall' : rate === '0.00%' ? 'price-steady' : 'price-unavailable';
  return {
    controls, panel,
    setEnabled(enabled: boolean) {
      toggleState.textContent = enabled ? 'ON' : 'OFF';
      toggle.setAttribute('aria-label', enabled ? '지적도 끄기' : '지적도 켜기');
      toggle.setAttribute('aria-pressed', String(enabled));
    },
    setFeatureVisible(visible: boolean, hasSelection: boolean) {
      status.hidden = !visible || !status.textContent;
      panel.hidden = !visible || !hasSelection;
    },
    setStatus(value: string, busy = false) { status.textContent = value; status.hidden = !value; status.setAttribute('aria-busy', String(busy)); },
    setBoundaryStatus(value: string, busy = false) {
      boundaryStatus.textContent = value; boundaryStatus.hidden = !value;
      boundaryStatus.setAttribute('aria-busy', String(busy));
    },
    clear() { panel.hidden = true; base.replaceChildren(); ledger.replaceChildren(); price.replaceChildren(); history.open = false; history.hidden = true; historyContent.replaceChildren(); },
    showSelection(id: string, jibun: string | null, priceYear?: string) {
      panel.hidden = false;
      requestedYear = priceYear;
      history.open = false; history.hidden = priceYear !== undefined;
      message(historyContent, '조회된 이력을 준비 중입니다. 최신 가용 가격 확인을 위한 페이지 조회를 공유합니다.');
      base.replaceChildren();
      const lot = document.createElement('p'); lot.className = 'parcel-lot-number'; lot.textContent = jibun ?? '지번 미제공';
      const identifier = document.createElement('p'); identifier.className = 'parcel-pnu'; identifier.textContent = `PNU ${id}`;
      base.append(lot, identifier);
      message(ledger, '토지정보 불러오는 중…'); message(price, priceYear === undefined ? '최신 가용 공시지가 확인 중…' : `${priceYear}년 공시지가 불러오는 중…`);
    },
    renderLedger(state: AttributeState<LandLedger>) {
      ledger.replaceChildren();
      if (state.status === 'ok') {
        const list = document.createElement('dl'), value = state.value; list.className = 'parcel-facts';
        const category = document.createElement('div'), area = document.createElement('div');
        field(category, '지목', value.landCategoryName ?? '미제공');
        field(area, '공부상 면적', value.registeredArea === null ? '미제공' : `${value.registeredArea.toLocaleString('ko-KR')} ㎡`);
        list.append(category, area); ledger.append(list);
      } else message(ledger, state.message);
    },
    renderPrice(state: AttributeState<LandPriceBatch>, historyState?: PriceHistorySnapshot) {
      price.replaceChildren();
      // 같은 연도의 서로 다른 기준월을 구분할 때만 기본 화면에 월을 표시한다.
      const needsMonth = (value: LandPriceBatch['records'][number]) => state.status === 'ok' &&
        new Set(state.value.records.filter((record) => record.pnu === value.pnu && record.year === value.year).map((record) => record.month)).size > 1;
      const monthLabel = (value: LandPriceBatch['records'][number]) => value.month ? `${value.month}월` : '월 미제공';
      const label = document.createElement('h3');
      label.textContent = historyState ? historyState.latestYear ? `최신 가용 개별공시지가 · ${historyState.latestYear}년` : historyState.phase === 'loading' ? '최신 가용 공시지가 확인 중…' : '개별공시지가 · 최신 연도 미확인'
        : requestedYear === undefined ? '개별공시지가' : `${requestedYear}년 개별공시지가`; price.append(label);
      if (historyState) {
        history.hidden = false; historyContent.replaceChildren();
        const progress = document.createElement('p');
        progress.textContent = `${historyState.pagesLoaded}/${historyState.expectedPages ?? '?'}페이지 · ${historyState.phase === 'loading' ? '조회 중' : historyState.phase === 'complete' ? 'API 메타데이터 기준 전체 조회' : historyState.phase === 'not-found' ? '자료 없음' : '조회 미완료'}`;
        historyContent.append(progress);
        if (historyState.warning) { const warning = document.createElement('p'); warning.className = 'parcel-data-warning'; warning.textContent = historyState.warning; price.append(warning); }
        if (historyState.phase === 'not-found') { const empty = document.createElement('p'); empty.textContent = '조회 가능한 공시지가 자료가 없습니다.'; price.append(empty); }
        const table = document.createElement('table'); table.className = 'parcel-history-table';
        const caption = document.createElement('caption'); caption.textContent = '반환된 연도의 공시지가와 전년 대비';
        const head = document.createElement('thead'), headingRow = document.createElement('tr');
        for (const title of ['기준연도', '공시지가(원/㎡)', '전년 대비']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; headingRow.append(cell); }
        head.append(headingRow); const body = document.createElement('tbody');
        for (const value of historyState.statistics) {
          const row = document.createElement('tr'), year = document.createElement('td'), amount = document.createElement('td'), change = document.createElement('td');
          const basis = document.createElement('small'); basis.textContent = `${needsMonth(value.record) ? `${monthLabel(value.record)} · ` : ''}공시 ${value.record.publishedAt ?? '일자 미제공'}`;
          year.textContent = value.record.year; year.append(basis);
          amount.textContent = value.record.pricePerSquareMeter?.toLocaleString('ko-KR') ?? '미제공'; change.textContent = value.rate; change.className = rateClass(value.rate);
          if (value.comparisonNote) { const caution = document.createElement('small'); caution.textContent = value.comparisonNote; change.append(caution); }
          row.append(year, amount, change); body.append(row);
        }
        table.append(caption, head, body); if (historyState.statistics.length) historyContent.append(table);
        const scope = document.createElement('p'); scope.className = 'parcel-history-scope'; scope.textContent = 'API에서 제공된 연도만 표시합니다. 더 오래된 이력이 없다는 뜻은 아닙니다.'; historyContent.append(scope);
      }
      if (state.status === 'ok') {
        const batch = state.value;
        if (batch.completeness !== 'complete' && historyState?.phase !== 'not-found') {
          const warning = document.createElement('p'); warning.className = 'parcel-data-warning'; warning.setAttribute('role', 'status');
          warning.textContent = batch.completeness === 'partial' ? '일부 자료만 조회되었습니다.' : '전체 자료 조회 여부는 미확인입니다.';
          price.append(warning);
        }
        // 화면 표시만 묶는다. 파서 결과와 원본 레코드 목록은 변경하지 않는다.
        const groups = new Map<string, typeof batch.records[number]>();
        batch.records.forEach((value, index) => {
          const completeKey = value.month !== null && value.publishedAt !== null && value.pricePerSquareMeter !== null;
          const key = completeKey ? JSON.stringify([value.pnu, value.year, value.month, value.publishedAt, value.pricePerSquareMeter]) : `unknown-${index}`;
          if (!groups.has(key)) groups.set(key, value);
        });
        for (const value of groups.values()) {
          if (historyState?.latestYear && value.year !== historyState.latestYear) continue;
          const card = document.createElement('article'); card.className = 'parcel-price-card';
          const amount = document.createElement('p'); amount.className = 'parcel-price-amount';
          const number = document.createElement('strong'); number.textContent = value.pricePerSquareMeter === null ? '미제공' : value.pricePerSquareMeter.toLocaleString('ko-KR');
          const unit = document.createElement('span'); unit.textContent = '원/㎡'; amount.append(number, unit);
          const basis = document.createElement('p'); basis.className = 'parcel-price-basis';
          basis.textContent = `${value.year}년${needsMonth(value) ? ` ${monthLabel(value)}` : ''} 기준 · 공시 ${value.publishedAt ?? '일자 미제공'}`;
          card.append(amount, basis);
          const statistic = historyState?.statistics.find((row) => row.record.pnu === value.pnu && row.record.year === value.year && row.record.month === value.month && row.record.publishedAt === value.publishedAt && row.record.pricePerSquareMeter === value.pricePerSquareMeter);
          if (statistic) { const change = document.createElement('p'); change.className = `parcel-price-change ${rateClass(statistic.rate)}`; change.textContent = `전년 대비 ${statistic.rate}${statistic.comparisonNote ? ` · ${statistic.comparisonNote}` : ''}`; card.append(change); }
          price.append(card);
        }
      } else { const notice = document.createElement('p'); notice.textContent = state.message; price.append(notice); }
    },
    dispose() { toggle.removeEventListener('click', onToggle); close.removeEventListener('click', onClose); controls.remove(); panel.remove(); },
  };
}
