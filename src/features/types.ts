import type Map from 'ol/Map.js';

export interface MapFeature {
  id: string;
  // 모듈은 자신이 만든 레이어·이벤트·UI를 제거하는 함수를 반환한다.
  mount(context: {
    map: Map;
    searchHost: HTMLElement;
    parcelControlsHost: HTMLElement;
    parcelPanelHost: HTMLElement;
    vworldApiKey: string;
    vworldDomain?: string;
  }): () => void;
}
