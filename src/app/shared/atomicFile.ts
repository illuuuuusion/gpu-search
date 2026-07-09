import fs from 'node:fs/promises';
import path from 'node:path';

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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (backupCount > 0) {
    await rotateBackups(filePath, backupCount);
  }
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, content);
  await fs.rename(tmpPath, filePath);
}
