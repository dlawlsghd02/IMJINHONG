import { requestSandboxJsonp } from './sandboxJsonp';

// 기존 지적 어댑터의 공개 함수와 요청 파라미터는 유지한다.
export function requestCadastralJsonp(parameters: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  return requestSandboxJsonp('cadastral', parameters, signal);
}
