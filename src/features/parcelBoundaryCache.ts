import { parcelConfig } from '../config/parcel';
import type { ParcelBatch, ParcelFeature } from '../services/vworld/cadastral';

interface Entry { features: ParcelFeature[]; expiresAt: number; coordinates: number }

// 지도 인스턴스 안에서만 사용하는 유한 LRU다. 키·원본 응답·불완전한 응답은 저장하지 않는다.
export function createParcelBoundaryCache() {
  const entries = new Map<string, Entry>();
  const copy = (feature: ParcelFeature) => {
    const clone = feature.clone(); clone.setId(feature.getId()); return clone;
  };
  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  };
  const withinBudget = () => {
    let features = 0, coordinates = 0;
    for (const entry of entries.values()) { features += entry.features.length; coordinates += entry.coordinates; }
    return entries.size <= parcelConfig.cacheMaxEntries && features <= parcelConfig.cacheMaxFeatures && coordinates <= parcelConfig.cacheMaxCoordinates;
  };
  return {
    get(key: string): ParcelBatch | undefined {
      prune();
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return { features: entry.features.map(copy), truncated: false, completeness: 'complete' };
    },
    put(key: string, batch: ParcelBatch) {
      prune(); entries.delete(key);
      if (batch.completeness !== 'complete' || batch.truncated) return;
      let coordinates = 0;
      for (const feature of batch.features) {
        const geometry = feature.getGeometry();
        if (geometry) coordinates += geometry.getFlatCoordinates().length / geometry.getStride();
      }
      if (batch.features.length > parcelConfig.cacheMaxFeatures || coordinates > parcelConfig.cacheMaxCoordinates) return;
      entries.set(key, { features: batch.features.map(copy), coordinates, expiresAt: Date.now() + parcelConfig.cacheTtlMs });
      while (!withinBudget()) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() { entries.clear(); },
  };
}
