import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../app/env/index.js';
import { logger } from '../../../app/shared/logger.js';
import { writeFileAtomic } from '../../../app/shared/atomicFile.js';
import { normalizeListingText } from './listingSignals.js';

const DEFAULT_PATH = path.resolve(process.cwd(), 'data/runtime-exclusions.json');

function getPath(): string {
  return env.EXCLUSIONS_STATE_PATH ?? DEFAULT_PATH;
}

// C2: laufzeit-gemeldeter Ausschlussbegriff, pro Profil gescoped, mit Metadaten.
export interface RuntimeExclusion {
  id: string;
  profileName: string;
  term: string;
  reportedAt: string;
  reportedByUserId: string;
  originalListingId: string;
  originalListingTitle: string;
  status: 'active' | 'reverted';
}

interface RuntimeExclusionsFile {
  version: 1;
  updatedAt: string;
  exclusions: RuntimeExclusion[];
}

// Singleton: der Scanner liest die aktiven Begriffe pro Tick (sync), der
// Discord-Flow schreibt sie. filterEngine nutzt den Sync-Reader.
class RuntimeExclusionStore {
  private exclusions: RuntimeExclusion[] = [];
  private loadPromise: Promise<void> | null = null;
  private nextId = 1;

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal();
    }
    await this.loadPromise;
  }

  // Aktive, pro Profil gescopte Begriffe (normalisiert). Leer, falls noch nicht geladen.
  getActiveTerms(profileName: string): string[] {
    return this.exclusions
      .filter(exclusion => exclusion.status === 'active' && exclusion.profileName === profileName)
      .map(exclusion => exclusion.term);
  }

  listActive(sinceDays?: number): RuntimeExclusion[] {
    const cutoff = sinceDays ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
    return this.exclusions.filter(exclusion =>
      exclusion.status === 'active' && new Date(exclusion.reportedAt).getTime() >= cutoff);
  }

  async add(input: Omit<RuntimeExclusion, 'id' | 'reportedAt' | 'status'>): Promise<RuntimeExclusion> {
    const exclusion: RuntimeExclusion = {
      ...input,
      term: input.term.trim(),
      id: String(this.nextId++),
      reportedAt: new Date().toISOString(),
      status: 'active',
    };
    this.exclusions.push(exclusion);
    await this.persist();
    return exclusion;
  }

  async revert(id: string): Promise<boolean> {
    const exclusion = this.exclusions.find(entry => entry.id === id && entry.status === 'active');
    if (!exclusion) {
      return false;
    }
    exclusion.status = 'reverted';
    await this.persist();
    return true;
  }

  private async loadInternal(): Promise<void> {
    try {
      const raw = await fs.readFile(getPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<RuntimeExclusionsFile>;
      this.exclusions = (parsed.exclusions ?? []).filter((entry): entry is RuntimeExclusion =>
        Boolean(entry?.id && entry?.profileName && entry?.term && entry?.status));
      this.nextId = this.exclusions.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn({ error }, 'Failed to load runtime exclusions');
      }
    }
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(getPath(), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      exclusions: this.exclusions,
    } satisfies RuntimeExclusionsFile, null, 2), env.SCANNER_STATE_BACKUP_COUNT);
  }
}

export const runtimeExclusionStore = new RuntimeExclusionStore();

// Prueft, ob ein (normalisierter) Text einen aktiven Ausschlussbegriff des Profils
// enthaelt. Wird von filterEngine genutzt.
export function matchesRuntimeExclusion(normalizedText: string, profileName: string): string | null {
  for (const term of runtimeExclusionStore.getActiveTerms(profileName)) {
    const normalizedTerm = normalizeListingText(term);
    if (normalizedTerm && normalizedText.includes(normalizedTerm)) {
      return term;
    }
  }
  return null;
}
