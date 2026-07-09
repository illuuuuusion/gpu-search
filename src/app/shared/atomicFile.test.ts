import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeFileAtomic } from './atomicFile.js';

test('writeFileAtomic keeps at most `keep` backups, newest is previous content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpu-search-atomic-'));
  const file = path.join(dir, 'state.json');
  try {
    for (const value of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      await writeFileAtomic(file, value, 3);
    }

    assert.equal(await fs.readFile(file, 'utf8'), 'v5');
    assert.equal(await fs.readFile(`${file}.bak.1`, 'utf8'), 'v4');
    assert.equal(await fs.readFile(`${file}.bak.2`, 'utf8'), 'v3');
    assert.equal(await fs.readFile(`${file}.bak.3`, 'utf8'), 'v2');
    await assert.rejects(fs.access(`${file}.bak.4`));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic with backupCount 0 writes no backups', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpu-search-atomic-'));
  const file = path.join(dir, 'state.json');
  try {
    await writeFileAtomic(file, 'a', 0);
    await writeFileAtomic(file, 'b', 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'b');
    await assert.rejects(fs.access(`${file}.bak.1`));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
