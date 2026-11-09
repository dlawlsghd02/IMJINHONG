import { basemapDefinitions, vworldConfig } from './config';
import type { TileLayerId } from './config';

export function createTileUrl(id: TileLayerId, apiKey: string): string {
  const definition = basemapDefinitions[id];
  return `${vworldConfig.endpoint}/${encodeURIComponent(apiKey)}/${definition.layer}/{z}/{y}/{x}.${definition.extension}`;
}
