import type {
  CompositionRecord,
  ValorantCompositionProvider,
  ValorantSourceEvent,
} from '../domain/models.js';

export interface ValorantProviderImportOptions {
  now: Date;
  windowDays: number;
}

export interface ValorantProviderImportResult {
  provider: ValorantCompositionProvider;
  sourceEvents: ValorantSourceEvent[];
  compositions: CompositionRecord[];
}

export interface ValorantCompositionDataProvider {
  readonly name: ValorantCompositionProvider;
  importData(options: ValorantProviderImportOptions): Promise<ValorantProviderImportResult>;
}
