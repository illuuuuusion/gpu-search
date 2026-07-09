import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../app/env/index.js';
import { logger } from '../../../app/shared/logger.js';
import { writeFileAtomic } from '../../../app/shared/atomicFile.js';
import type { EbayListing, GpuProfile } from './models.js';
import { normalizeListingText } from './listingSignals.js';
import { aliasCandidates } from './aliasMatcher.js';
import { similarityRatio } from './aliasSimilarity.js';

// B6: semantisches Alias-Fallback.
// ponytail: BEWUSST regelbasiert (Token-/Levenshtein-Aehnlichkeit gegen die
// Alias-Liste) statt eines lokalen Embedding-Modells. Das geforderte Ziel ist
// "Near-Miss finden und LOGGEN, nicht live alarmieren" — und es gab keine
// konkreten verpassten Beispiele. Ein ~25MB-ONNX/WASM-Modell + Docker-Volume +
// neue Dependency fuer eine reine Logging-Liste bei zwei Nutzern waere
// Over-Engineering. Upgrade-Pfad: falls diese Heuristik echte Faelle verpasst,
// hier @xenova/transformers + Cosine-Similarity einhaengen (gleiche Signatur).

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), 'data/alias-fallback-log.json');

function getLogPath(): string {
  return env.ALIAS_FALLBACK_LOG_PATH ?? DEFAULT_LOG_PATH;
}

export interface AliasFallbackHit {
  listingId: string;
  listingTitle: string;
  profileName: string;
  alias: string;
  similarity: number;
  at: string;
}

// Bestes token-basiertes Aehnlichkeitsmass zwischen Titel-Wortgruppen und Alias.
function bestSimilarity(titleNormalized: string, alias: string): number {
  const words = titleNormalized.split(' ').filter(Boolean);
  let best = 0;
  for (const candidate of aliasCandidates(alias)) {
    const candidateWordCount = candidate.split(' ').filter(Boolean).length || 1;
    // Gleitendes Fenster ueber die Titelwoerter in Alias-Laenge.
    for (let i = 0; i + candidateWordCount <= words.length; i += 1) {
      const window = words.slice(i, i + candidateWordCount).join(' ');
      best = Math.max(best, similarityRatio(window, candidate));
    }
    // Auch gegen den ganzen (kompakten) Titel messen, fuer zusammengeschriebene Faelle.
    best = Math.max(best, similarityRatio(titleNormalized.replace(/\s+/g, ''), candidate.replace(/\s+/g, '')));
  }
  return best;
}

export function findAliasFallback(listing: EbayListing, profiles: GpuProfile[]): AliasFallbackHit | null {
  const titleNormalized = normalizeListingText(listing.title);
  if (!titleNormalized) {
    return null;
  }

  let best: AliasFallbackHit | null = null;
  for (const profile of profiles) {
    for (const alias of profile.aliases) {
      const similarity = bestSimilarity(titleNormalized, alias);
      if (similarity >= env.ALIAS_FALLBACK_MIN_SIMILARITY && (!best || similarity > best.similarity)) {
        best = {
          listingId: listing.id,
          listingTitle: listing.title,
          profileName: profile.name,
          alias,
          similarity: Number(similarity.toFixed(3)),
          at: new Date().toISOString(),
        };
      }
    }
  }

  return best;
}

// ponytail: globaler Promise-Chain-Mutex. Der Scanner ruft logAliasFallback
// fuer hunderte Listings parallel auf -> ohne Serialisierung rasen die
// read-modify-write-Zyklen + der gemeinsame .tmp-Pfad (rename ENOENT, lost
// updates). Ein Prozess, eine Datei -> ein Lock reicht. Upgrade: per-Datei-Lock,
// falls mehrere Log-Ziele dazukommen.
let writeChain: Promise<void> = Promise.resolve();

// Nur anhaengen + persistieren (Logging-only, kein Live-Alarm). Best effort.
export function logAliasFallback(hit: AliasFallbackHit): Promise<void> {
  writeChain = writeChain.then(() => appendAliasFallback(hit));
  return writeChain;
}

async function appendAliasFallback(hit: AliasFallbackHit): Promise<void> {
  try {
    let existing: AliasFallbackHit[] = [];
    try {
      const raw = await fs.readFile(getLogPath(), 'utf8');
      const parsed = JSON.parse(raw) as { hits?: AliasFallbackHit[] };
      existing = parsed.hits ?? [];
    } catch (error) {
      // ENOENT (first write) or corrupt JSON: start fresh and let the write below
      // repair the file. Rethrowing here left a bad file un-repaired -> every
      // subsequent listing re-read it and re-failed, flooding the logs.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ error, path: getLogPath() }, 'alias fallback log unreadable, recreating');
      }
    }
    existing.push(hit);
    await writeFileAtomic(getLogPath(), JSON.stringify({ updatedAt: new Date().toISOString(), hits: existing.slice(-500) }, null, 2));
    logger.info({ ...hit }, 'alias fallback near-miss logged');
  } catch (error) {
    logger.warn({ error, listingId: hit.listingId }, 'failed to log alias fallback');
  }
}
