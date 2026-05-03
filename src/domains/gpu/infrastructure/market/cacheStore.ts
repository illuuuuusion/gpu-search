import fs from 'node:fs/promises';
import path from 'node:path';
import type { MarketReference } from '../../domain/models.js';
import type { MarketReferenceCacheFile } from './types.js';
import { logger } from '../../../../app/shared/logger.js';

export async function loadMarketReferenceCache(cachePath: string): Promise<Map<string, MarketReference>> {
  const references = new Map<string, MarketReference>();

  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MarketReferenceCacheFile>;
    if (parsed.version !== 1) {
      return references;
    }

    for (const entry of parsed.entries ?? []) {
      if (
        entry?.profileName &&
        entry?.query &&
        typeof entry.lowestPriceEur === 'number' &&
        Array.isArray(entry.families) &&
        typeof entry.fetchedAt === 'string'
      ) {
        references.set(entry.profileName, {
          source: entry.source,
          query: entry.query,
          url: entry.url,
          lowestPriceEur: entry.lowestPriceEur,
          fetchedAt: entry.fetchedAt,
          families: entry.families,
          note: entry.note,
        });
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn({ error, cachePath }, 'Failed to load market reference cache');
    }
  }

  return references;
}

export async function persistMarketReferenceCache(
  cachePath: string,
  references: ReadonlyMap<string, MarketReference>,
): Promise<void> {
  const entries = Array.from(references.entries()).map(([profileName, reference]) => ({
    profileName,
    ...reference,
  }));

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  } satisfies MarketReferenceCacheFile, null, 2));
}
