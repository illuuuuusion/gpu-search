import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../../app/shared/logger.js';

const REDACT_KEY_PATTERN = /token|secret|password|authorization|api[-_]?key/i;

// Alles, was nach Zugangsdaten aussieht, wird vor dem Schreiben ersetzt --
// der Audit-Trail darf nie ein Secret enthalten.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.map(entry => redact(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        REDACT_KEY_PATTERN.test(key) ? '[redacted]' : redact(entry, depth + 1),
      ]),
    );
  }
  return value;
}

export interface AuditEntry {
  event: string;
  requestId?: string;
  actorUserId?: string;
  guildId?: string;
  toolName?: string;
  decision?: string;
  reason?: string;
  args?: unknown;
  approvalId?: string;
}

// ponytail: append-only JSONL statt Datenbank. Ceiling: Rotation uebernimmt
// logrotate/der Betrieb (docs/ai-agent/operations.md).
export class AuditLog {
  constructor(private readonly filePath: string) {}

  async record(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), ...(redact(entry) as AuditEntry) });
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
    } catch (error) {
      // Audit-Fehler duerfen den Bot nicht anhalten, aber muessen sichtbar sein.
      logger.error({ error, file: this.filePath }, 'failed to append ai audit entry');
    }
  }
}
