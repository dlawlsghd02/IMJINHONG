import type { MapFeature } from './types';
import { addressSearchFeature } from './addressSearch';
import { cadastralFeature } from './cadastral';

// 지적 기능은 기본 꺼짐이며, 자동 BOX 조회와 상세 속성 전송은 검증 전 비활성이다.
export const features: readonly MapFeature[] = [addressSearchFeature, cadastralFeature];
