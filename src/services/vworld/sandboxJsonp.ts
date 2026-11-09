import { parcelConfig } from '../../config/parcel';
import { ParcelError } from './parcelValidation';

export type SandboxService = 'cadastral' | 'ledger' | 'price' | 'landUse';
const endpoints = { cadastral: '/req/data', ledger: '/ned/data/ladfrlList', price: '/ned/data/getIndvdLandPriceAttr', landUse: '/ned/data/getLandUseAttr' } as const;
export function requestSandboxJsonp(service: SandboxService, parameters: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Invalidated', 'AbortError')); return; }
    const id = crypto.randomUUID().replaceAll('-', '');
    const callback = `__imjinhong_parcel_${id}`;
    if (!Object.hasOwn(endpoints, service)) { reject(new ParcelError('허용되지 않은 API 서비스입니다.', 'transport')); return; }
    const endpoint = 'https://api.vworld.kr' + endpoints[service];
    const url = new URL(endpoint);
    url.search = new URLSearchParams(parameters).toString();
    url.searchParams.set('callback', callback);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = '지적 경계 요청';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const literal = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
    frame.srcdoc = `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${id}' ${endpoint}; base-uri 'none'; form-action 'none'">
      <script nonce="${id}">(() => {
        const notify = (type, payload) => parent.postMessage({channel:'imjinhong-parcel',id:${literal(id)},type,payload}, ${literal(window.location.origin)});
        window.addEventListener('error', event => {event.preventDefault();notify('execution-error',null);});
        window[${literal(callback)}] = payload => notify('result',payload);
        const script = document.createElement('script');
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        script.src = ${literal(url.href)};
        script.onerror = () => notify('load-error',null);
        document.head.append(script);
      })();<\/script>`;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: Error | null, payload?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      frame.remove(); // 콜백이 존재하는 별도 window도 함께 폐기한다.
      if (error) reject(error); else resolve(payload);
    };
    const abort = () => finish(new DOMException('Invalidated', 'AbortError'));
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null' || !event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (message.channel !== 'imjinhong-parcel' || message.id !== id) return;
      if (message.type === 'result') finish(null, message.payload);
      else if (message.type === 'load-error') finish(new ParcelError('지적 스크립트 로드 실패: 네트워크·서비스 URL 설정을 확인하세요.', 'transport'));
      else if (message.type === 'execution-error') finish(new ParcelError('지적 JSONP 실행 실패: 응답 형식·인증 설정을 확인하세요.', 'transport'));
    };
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new ParcelError('지적 조회 시간이 초과되었습니다. 자동 재시도하지 않습니다.', 'timeout')), parcelConfig.timeoutMs);
    try { document.body.append(frame); }
    catch { finish(new ParcelError('지적 요청을 초기화하지 못했습니다.', 'transport')); }
  });
}
