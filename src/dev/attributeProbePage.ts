import { runAttributeProbe } from './attributeProbe';

if (import.meta.env.DEV) {
  const controller = new AbortController();
  window.addEventListener('pagehide', () => controller.abort(), { once: true });
  import.meta.hot?.dispose(() => controller.abort());
  const root = document.querySelector('#app');
  if (!root) throw new Error('진단 화면 컨테이너가 없습니다.');
  const heading = document.createElement('h1'); heading.textContent = '토지 속성 API 개발 진단';
  const note = document.createElement('p');
  note.textContent = '지도와 분리된 개발 전용 화면입니다. 버튼을 누르면 선택한 서비스에 JSONP 요청을 1회 시도합니다. 자동 재시도·추가 페이지 조회는 없습니다. HTTP 상태는 JSONP에서 직접 확인할 수 없습니다. 입력 연도는 최신 연도라는 뜻이 아닙니다.';
  const form = document.createElement('form'); form.addEventListener('submit', (event) => event.preventDefault());
  const pnuLabel = document.createElement('label'); pnuLabel.textContent = 'PNU (19자리) ';
  const pnuInput = document.createElement('input'); pnuInput.type = 'text'; pnuInput.inputMode = 'numeric'; pnuInput.maxLength = 19;
  pnuLabel.append(pnuInput);
  const yearLabel = document.createElement('label'); yearLabel.textContent = '공시지가 기준연도 ';
  const year = document.createElement('input'); year.type = 'text'; year.inputMode = 'numeric'; year.maxLength = 4; year.placeholder = '직접 입력';
  yearLabel.append(year); form.append(pnuLabel, document.createElement('br'), yearLabel);
  const omissionNote = document.createElement('p');
  omissionNote.textContent = '기준연도 생략 조회는 연도 입력란을 사용하지 않고 선택한 페이지 하나만 1회 요청합니다. 페이지별 결과를 자동 합산하지 않으며 전체 과거 이력 제공을 보장하지 않습니다.';
  form.append(omissionNote);
  for (const [service, label, omitYear] of [['ledger', '토지임야 진단', false], ['price', '개별공시지가 지정연도 진단', false], ['price', '기준연도 생략 조회 (1회)', true]] as const) {
    const section = document.createElement('section');
    const page = document.createElement('select');
    if (omitYear) {
      const pageLabel = document.createElement('label'); pageLabel.textContent = '생략 조회 페이지 ';
      for (const value of [1, 2]) {
        const option = document.createElement('option'); option.value = String(value); option.textContent = `${value}페이지`; page.append(option);
      }
      pageLabel.append(page); section.append(pageLabel);
    }
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    const output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.whiteSpace = 'pre-wrap';
    output.textContent = '미실행';
    button.addEventListener('click', async () => {
      button.disabled = true;
      output.textContent = 'JSONP 응답 대기 중…';
      try {
        const result = await runAttributeProbe(service, pnuInput.value, omitYear ? undefined : year.value, controller.signal, omitYear ? Number(page.value) : 1);
        if (controller.signal.aborted) return;
        output.textContent = [
          `전송 시도: ${result.executed ? '예 (실제 HTTP 송신 횟수는 별도 확인)' : '아니요'}`, `상태: ${{ blocked: '차단', success: '성공', 'not-found': '자료 없음', failed: '실패' }[result.state]}`,
          `진단 코드: ${result.diagnostic ?? '없음'}`,
          `실패 단계: ${result.failureStage ?? '없음'}`,
          `전송: ${result.transport}`, `HTTP 상태: ${result.httpStatus ?? '미확인'}`,
          `API 코드: ${result.apiCode}`, `반환 건수: ${result.count ?? '미확인'}`,
          ...(service === 'price' ? [`요청한 페이지: ${result.requestedPage ?? 1} (페이지당 10건)`, '이 결과는 현재 페이지 단독 응답입니다. 다른 페이지와 자동 병합하지 않습니다.'] : []),
          ...(service === 'price' ? [
            `요청 연도 조건: ${result.yearMode === 'omitted' ? 'stdrYear 생략' : '지정연도'}`,
            `실제 반환 연도: ${result.returnedYears?.join(', ') || '확인된 레코드 없음'}`,
            '전체 과거 이력 제공 여부: 미확인 (페이지 완전성과 별개)',
          ] : []),
          `확인한 허용 필드: ${result.fields.join(', ') || '없음'}`, `PNU 일치: ${result.pnuMatches === true ? '확인' : '미확인'}`,
          `지목: ${result.landCategory ?? '미확인'}`, `지목 코드: ${result.landCategoryCode ?? '미확인'}`, `공부상 면적(㎡): ${result.area ?? '미확인'}`,
          ...(result.priceRecords ? [
            `공시지가 표시 행 수: ${result.priceRecords.length}`, `완전 중복 제거: ${result.duplicatesRemoved ?? 0}건`,
            `전체 건수: ${result.totalCount ?? '미확인'}`, `페이지 크기: ${result.pageSize ?? '미확인'}`, `응답 페이지 번호: ${result.pageNo ?? '미확인'}`, `현재 페이지 반환 건수: ${result.count ?? '미확인'}`,
            `반환 조회 조건의 페이지 완전성: ${{ complete: '완전 조회 (API 메타데이터 기준)', partial: '부분 조회', unknown: '완전성 미확인' }[result.priceCompleteness ?? 'unknown']}`,
            ...result.priceRecords.flatMap((record, index) => [
              `공시지가 레코드 ${index + 1}`,
              `  기준연월: ${record.year}년 ${record.month ?? '월 미제공'}`,
              `  가격(원/㎡): ${record.pricePerSquareMeter?.toLocaleString('ko-KR') ?? '미제공'}`,
              `  공시일: ${record.publishedAt ?? '미제공'}`, `  갱신일: ${record.updatedAt ?? '미제공'}`,
            ]),
          ] : []), result.message,
          ...(result.responseShape ? ['응답 구조 요약 (원문 값 제외):', ...result.responseShape] : []),
        ].join('\n');
      } catch { output.textContent = '진단 처리 실패. 원문 오류와 인증정보는 표시하지 않습니다.'; }
      finally { button.disabled = false; }
    });
    section.append(button, output); form.append(section);
  }
  root.replaceChildren(heading, note, form);
}
