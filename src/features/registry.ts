import type { MapFeature } from './types';
import { addressSearchFeature } from './addressSearch';
import { cadastralFeature } from './cadastral';
import { zoningFeature } from './zoning';
import { ownershipFeature } from './ownership';

// 레이어 기능은 최초 OFF이며 각각 독립적으로 초기화·해제한다.
export const features: readonly MapFeature[] = [addressSearchFeature, cadastralFeature, zoningFeature, ownershipFeature];
