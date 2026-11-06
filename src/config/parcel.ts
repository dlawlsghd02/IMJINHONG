// 공식 API 제한이 아닌 초기 애플리케이션 운영값이다.
export const parcelConfig = {
  autoBoundaryQueryEnabled: false,
  minZoom: 17,
  maxAreaSquareMeters: 250_000,
  maxFeatures: 200,
  pointResultLimit: 5,
  moveDelayMs: 350,
  timeoutMs: 15_000,
  priceYear: '2026',
} as const;
