export type ParcelErrorKind = 'api' | 'unexpected-status' | 'validation' | 'transport' | 'timeout';

const parcelDiagnosticCodes = {
  api: 'PARCEL_API_ERROR',
  'unexpected-status': 'PARCEL_API_STATUS',
  validation: 'PARCEL_RESPONSE_INVALID',
  transport: 'PARCEL_JSONP_ERROR',
  timeout: 'PARCEL_TIMEOUT',
} as const;

export class ParcelError extends Error {
  readonly diagnosticCode: typeof parcelDiagnosticCodes[ParcelErrorKind];

  // message는 호출부에서 작성한 안전한 안내만 전달한다. 서버 원문을 받지 않는다.
  constructor(message: string, readonly kind: ParcelErrorKind = 'validation') {
    const code = parcelDiagnosticCodes[kind];
    super(`[${code}] ${message}`);
    this.name = 'ParcelError';
    this.diagnosticCode = code;
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParcelError('응답 구조가 올바르지 않습니다.');
  return value as Record<string, unknown>;
}

export function pnu(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{19}$/.test(value)) throw new ParcelError('PNU가 19자리 문자열이 아닙니다.');
  return value;
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;
}

export function nonNegative(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new ParcelError('수치가 누락되었습니다.');
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) throw new ParcelError('수치 문자열 형식이 올바르지 않습니다.');
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new ParcelError('수치 범위가 올바르지 않습니다.');
  return result;
}

export function integer(value: unknown): number {
  const result = nonNegative(value);
  if (!Number.isSafeInteger(result)) throw new ParcelError('건수 정보가 올바르지 않습니다.');
  return result;
}

export function date(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ParcelError('기준일 형식이 올바르지 않습니다.');
  return value;
}

// 실제 응답의 최상위 봉투는 고정한다. 내부 목록의 포장 차이는 제한된 깊이에서
// PNU를 가진 행만 찾고, 각 어댑터에서 허용한 속성만 새 객체에 복사한다.
export function attributeRows(payload: unknown, rootName: string, requestedPnu: string): Record<string, unknown>[] {
  pnu(requestedPnu);
  const root = object(object(payload)[rootName]);
  const code = text(root.resultCode);
  if (code && code !== '00' && code !== '0') throw new ParcelError('속성 API가 오류 상태를 반환했습니다.');
  const rows: Record<string, unknown>[] = [];
  let nodes = 0;
  function visit(value: unknown, depth: number) {
    if (++nodes > 1000 || depth > 6) throw new ParcelError('속성 응답의 크기 또는 깊이가 상한을 초과했습니다.');
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const row = object(value);
    if ('pnu' in row) {
      if (pnu(row.pnu) !== requestedPnu) throw new ParcelError('요청한 PNU와 속성 응답이 다릅니다.');
      rows.push(row);
      if (rows.length > 10) throw new ParcelError('속성 응답 건수가 상한을 초과했습니다.');
      return;
    }
    Object.values(row).forEach((child) => { if (child && typeof child === 'object') visit(child, depth + 1); });
  }
  visit(root, 0);
  if (root.totalCount !== undefined && integer(root.totalCount) !== rows.length) throw new ParcelError('속성 응답이 누락되었거나 추가 페이지가 있습니다.');
  return rows;
}

export type AttributeState<T> =
  | { status: 'ok'; value: T }
  | { status: 'unavailable' | 'not-found' | 'error'; message: string };
