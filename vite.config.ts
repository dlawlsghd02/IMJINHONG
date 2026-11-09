import { defineConfig } from 'vite';

export default defineConfig({ base: '/IMJINHONG/', plugins: [{
  name: 'development-attribute-probe',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = 'url' in request && typeof request.url === 'string' ? request.url.split('?')[0] : undefined;
      // Vite의 base middleware 전후 어느 경우에도 정확한 개발 전용 경로만 허용한다.
      if (path !== '/IMJINHONG/__dev/attributes' && path !== '/__dev/attributes') { next(); return; }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>속성 API 개발 진단</title><body><main id="app"></main><script type="module" src="/IMJINHONG/src/dev/attributeProbePage.ts"></script></body></html>');
    });
  },
}] });
