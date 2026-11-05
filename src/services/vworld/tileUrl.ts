import { basemapDefinitions, vworldConfig } from './config';
import type { BasemapId } from './config';

export function createTileUrl(id: BasemapId, apiKey: string): string {
  const definition = basemapDefinitions[id];
  return `${vworldConfig.endpoint}/${encodeURIComponent(apiKey)}/${definition.layer}/{z}/{y}/{x}.${definition.extension}`;
}
