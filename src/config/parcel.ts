// 공식 API 제한이 아닌 초기 애플리케이션 운영값이다.
export const parcelConfig = {
  autoBoundaryQueryEnabled: import.meta.env.VITE_CADASTRAL_AUTO_BOX === 'true',
  pointMinZoom: 15,
  boxMinZoom: 15,
  maxAreaSquareMeters: 5_000_000,
  maxFeatures: 1_000,
  pointResultLimit: 5,
  moveDelayMs: 350,
  minBoxRequestIntervalMs: 1_500,
  cacheTtlMs: 60_000,
  cacheMaxEntries: 8,
  cacheMaxFeatures: 1_000,
  cacheMaxCoordinates: 100_000,
  maxBoxCoordinates: 200_000,
  timeoutMs: 15_000,
  priceYear: '2025',
} as const;
