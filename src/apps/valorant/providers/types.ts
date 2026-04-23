import type {
  CompositionRecord,
  ValorantCompositionProvider,
  ValorantMatchReference,
  ValorantSourceEvent,
} from '../domain/models.js';

export interface ValorantProviderImportOptions {
  now: Date;
  windowDays: number;
  existingMatchReferences: ValorantMatchReference[];
}

export interface ValorantProviderImportResult {
  provider: ValorantCompositionProvider;
  sourceEvents: ValorantSourceEvent[];
  matchReferences: ValorantMatchReference[];
  compositions: CompositionRecord[];
  warnings: string[];
}

export interface ValorantCompositionDataProvider {
  readonly name: ValorantCompositionProvider;
  importData(options: ValorantProviderImportOptions): Promise<ValorantProviderImportResult>;
}
