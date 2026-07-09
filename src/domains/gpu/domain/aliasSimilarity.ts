import type { GpuProfile } from './models.js';
import { normalizeListingText } from './listingSignals.js';
import { aliasCandidates } from './aliasMatcher.js';

// Standard-DP-Levenshtein. ponytail: ~15 Zeilen, keine Bibliothek noetig.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// Aehnlichkeit in [0,1]: 1 = identisch. Fuer B6-Fallback-Schwelle.
export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export interface AliasCollision {
  profileName: string;
  alias: string;
}

// C2-Sicherheitsnetz: wuerde `term` einen legitimen Alias treffen? Prueft
// Substring in beide Richtungen plus Levenshtein <= maxDistance. Permissiv
// kalibriert: nur echte Kollisionen blocken, sonst Ausschluss zulassen.
export function wouldBlockLegitimateAlias(
  term: string,
  profiles: GpuProfile[],
  maxDistance: number,
): AliasCollision | null {
  const normalizedTerm = normalizeListingText(term);
  const termCompact = normalizedTerm.replace(/\s+/g, '');
  if (!termCompact) {
    return null;
  }

  for (const profile of profiles) {
    for (const alias of profile.aliases) {
      for (const candidate of aliasCandidates(alias)) {
        const candidateCompact = candidate.replace(/\s+/g, '');
        if (!candidateCompact) continue;
        // "3070ti" trifft "rtx3070ti" (Substring in beide Richtungen, kompakt).
        if (candidateCompact.includes(termCompact) || termCompact.includes(candidateCompact)) {
          return { profileName: profile.name, alias };
        }
        // Levenshtein nur bei kurzen Begriffen (Tippfehler-Naehe zum ganzen Alias).
        if (candidateCompact.length <= 10 && levenshtein(termCompact, candidateCompact) <= maxDistance) {
          return { profileName: profile.name, alias };
        }
      }
    }
  }

  return null;
}
