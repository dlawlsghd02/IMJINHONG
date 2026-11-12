import type { ZoningLayerId } from '../services/vworld/zoningWms';

// UI 표시 명칭만 정의한다. 규제 판정 및 WMS 필터에는 사용하지 않는다.
export const zoningLegendCodeNames = {
  UQB300: '보전관리지역',
  UQB200: '생산관리지역',
  UQB100: '계획관리지역',
  UQC001: '농림지역',
  UQD001: '자연환경보전지역',
} as const;

export const majorLegendNames: Readonly<Record<ZoningLayerId, readonly string[]>> = {
  lt_c_uq111: ['주거지역', '상업지역', '공업지역', '녹지지역'],
  lt_c_uq112: [zoningLegendCodeNames.UQB300, zoningLegendCodeNames.UQB200, zoningLegendCodeNames.UQB100],
  lt_c_uq113: [zoningLegendCodeNames.UQC001],
  lt_c_uq114: [zoningLegendCodeNames.UQD001],
};
