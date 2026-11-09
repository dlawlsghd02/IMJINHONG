export function createLayout(root: HTMLElement) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div><h1>IMJINHONG</h1><p>전국 공간정보 지도</p></div>
        <div id="address-search-host"></div>
        <span class="header-description">대한민국에서 시작하는 공간 탐색</span>
      </header>
      <main class="map-shell" aria-label="전국 지도">
        <div id="map" tabindex="0" aria-label="지도. 방향키로 이동하고 더하기·빼기 키로 확대·축소할 수 있습니다."></div>
        <div class="basemap-controls" role="group" aria-label="배경지도 선택">
          <button type="button" data-basemap="base" aria-pressed="true" disabled>일반지도</button>
          <button type="button" data-basemap="satellite" aria-pressed="false" disabled>위성지도</button>
          <button type="button" data-map-names aria-label="위성지도 명칭 표시" aria-pressed="true" hidden disabled>명칭</button>
        </div>
        <div class="zoom-controls" role="group" aria-label="지도 확대·축소">
          <button type="button" data-zoom="1" aria-label="지도 확대" disabled>+</button>
          <button type="button" data-zoom="-1" aria-label="지도 축소" disabled>−</button>
        </div>
        <div class="layer-controls-stack">
          <div id="parcel-controls-host"></div>
          <div id="zoning-controls-host"></div>
        </div>
        <div id="parcel-panel-host"></div>
        <section class="status-panel" aria-label="지도 상태">
          <p id="map-status" role="status" aria-live="polite">지도 설정 확인 중…</p>
          <p id="hybrid-status" role="status" aria-live="polite" hidden></p>
          <button id="retry-tiles" type="button" hidden>타일 다시 요청</button>
        </section>
      </main>
      <footer class="coordinate-bar">
        <span id="coordinate-basis">좌표 대기</span>
        <output id="coordinates">—</output>
        <span>EPSG:4326</span>
      </footer>
    </div>`;
  const get = <T extends HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`화면 요소 누락: ${selector}`);
    return element;
  };
  return {
    target: get<HTMLDivElement>('#map'),
    searchHost: get<HTMLDivElement>('#address-search-host'),
    parcelControlsHost: get<HTMLDivElement>('#parcel-controls-host'),
    parcelPanelHost: get<HTMLDivElement>('#parcel-panel-host'),
    zoningHost: get<HTMLDivElement>('#zoning-controls-host'),
    status: get<HTMLParagraphElement>('#map-status'),
    hybridStatus: get<HTMLParagraphElement>('#hybrid-status'),
    retry: get<HTMLButtonElement>('#retry-tiles'),
    basis: get<HTMLSpanElement>('#coordinate-basis'),
    coordinates: get<HTMLOutputElement>('#coordinates'),
  };
}
