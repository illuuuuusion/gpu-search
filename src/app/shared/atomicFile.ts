import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// ponytail: eine Promise-Kette pro Zielpfad statt Mutex-Bibliothek.
// Haelt Backup-Rotation + Write eines Ziels als eine Operation zusammen.
// Ceiling: nur prozesslokal. Mehrere Prozesse auf derselben Datei braeuchten
// ein echtes Lockfile -- der eindeutige Temp-Pfad unten verhindert dort
// immerhin das gegenseitige ENOENT.
const writeQueues = new Map<string, Promise<unknown>>();

function serializePerFile<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.catch(() => undefined);
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) {
      writeQueues.delete(key); // Map nicht unbegrenzt wachsen lassen
    }
  });
  return result;
}

// ponytail: Directory-fsync ist nicht ueberall erlaubt (Windows) -> best effort.
async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch {
    // Verzeichnis-fsync nicht verfuegbar -> Rename bleibt trotzdem atomar.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

// ponytail: einfacher Ring-Puffer per rename/copyFile, keine Versionierungs-Bibliothek.
// Wird VOR dem eigentlichen Write aufgerufen -> .bak.1 traegt den letzten guten Stand.
export async function rotateBackups(filePath: string, keep: number): Promise<void> {
  if (keep <= 0) {
    return;
  }

  try {
    await fs.access(filePath);
  } catch {
    return; // noch keine Hauptdatei -> nichts zu rotieren
  }

  for (let i = keep; i >= 1; i -= 1) {
    const dest = `${filePath}.bak.${i}`;
    try {
      if (i === 1) {
        await fs.copyFile(filePath, dest);
      } else {
        await fs.rename(`${filePath}.bak.${i - 1}`, dest);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export async function writeFileAtomic(
  filePath: string,
  content: string,
  backupCount = 0,
): Promise<void> {
  return serializePerFile(path.resolve(filePath), async () => {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    if (backupCount > 0) {
      await rotateBackups(filePath, backupCount);
    }

    // Eindeutig pro Schreibvorgang: sonst nehmen sich parallele Writes
    // gegenseitig die Temp-Datei weg (ENOENT beim rename).
    const tmpName = `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const tmpPath = path.join(dir, tmpName);
    try {
      const handle = await fs.open(tmpPath, 'w');
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmpPath, filePath);
      await syncDirectory(dir);
    } finally {
      await fs.rm(tmpPath, { force: true }); // nach erfolgreichem rename ein No-op
    }
  });
}
