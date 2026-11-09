// 값·임의 필드명·PNU·URL은 보존하지 않는다. 허용 필드의 자료형/형식만 요약한다.
export function priceResponseShape(payload: unknown): string[] {
  const kind = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? `array(${value.length})` : typeof value;
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const output = [`payload: ${kind(payload)}`];
  if (!isObject(payload)) return output;
  output.push(`indvdLandPrices: ${kind(payload.indvdLandPrices)}`);
  output.push(`response: ${kind(payload.response)}`);
  output.push(`예상 봉투 외 최상위 필드 수: ${Object.keys(payload).filter((name) => !['indvdLandPrices', 'response'].includes(name)).length}`);
  if (!isObject(payload.indvdLandPrices)) return output;
  const root = payload.indvdLandPrices;
  for (const name of ['field', 'totalCount', 'numOfRows', 'pageNo', 'resultCode']) {
    const value = root[name];
    const count = ['totalCount', 'numOfRows', 'pageNo'].includes(name) && (typeof value === 'number' || typeof value === 'string') && /^\d{1,9}$/.test(String(value)) ? `=${Number(value)}` : '';
    output.push(`${name}: ${kind(value)}${count}`);
  }
  const fields = ['pnu', 'stdrYear', 'stdrMt', 'pblntfPclnd', 'pblntfDe', 'lastUpdtDt'];
  const shapes = new Map<string, Set<string>>();
  let nodes = 0, rows = 0, limited = false;
  function visit(value: unknown, depth: number) {
    if (++nodes > 200 || depth > 6) { limited = true; return; }
    if (Array.isArray(value)) { for (const item of value.slice(0, 20)) visit(item, depth + 1); if (value.length > 20) limited = true; return; }
    if (!isObject(value)) return;
    if (Object.hasOwn(value, 'pnu')) {
      rows++;
      for (const name of fields) {
        const item = value[name]; let shape = kind(item);
        if (typeof item === 'string') {
          if (item === '') shape += '/빈 문자열';
          else if (name === 'pnu') shape += /^\d{19}$/.test(item) ? '/19자리' : '/형식 불일치';
          else if (name === 'stdrYear') shape += /^\d{4}$/.test(item) ? '/네 자리' : '/형식 불일치';
          else if (name === 'stdrMt') shape += /^(0[1-9]|1[0-2])$/.test(item) ? '/두 자리 월' : '/형식 불일치';
          else if (name.endsWith('Dt') || name === 'pblntfDe') shape += /^\d{4}-\d{2}-\d{2}$/.test(item) ? '/YYYY-MM-DD' : /^\d{8}$/.test(item) ? '/8자리 날짜' : '/기타 형식';
          else shape += /^\d+(\.\d+)?$/.test(item) ? '/숫자 문자열' : '/기타 형식';
        }
        if (!shapes.has(name)) shapes.set(name, new Set()); shapes.get(name)?.add(shape);
      }
      return;
    }
    for (const child of Object.values(value).slice(0, 20)) if (child && typeof child === 'object') visit(child, depth + 1);
    if (Object.keys(value).length > 20) limited = true;
  }
  visit(root, 0);
  output.push(`탐색된 PNU 행 수: ${rows}${limited ? ' (요약 탐색 상한 도달)' : ''}`);
  for (const [name, types] of shapes) output.push(`행.${name}: ${[...types].join(', ')}`);
  return output;
}
