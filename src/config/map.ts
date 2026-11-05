// 대한민국은 초기 표시 프리셋일 뿐, 이동 가능한 지도 범위 제한이 아니다.
export const mapConfig = {
  viewProjection: 'EPSG:3857',
  displayProjection: 'EPSG:4326',
  initialExtent: [124.0, 32.7, 132.0, 39.3],
  minZoom: 5,
  maxZoom: 19,
  initialPadding: 24,
};
