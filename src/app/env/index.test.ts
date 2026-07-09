import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveSecretFileOverrides } from './index.js';

test('resolveSecretFileOverrides reads *_FILE into the plain env var', () => {
  const tmp = path.join(os.tmpdir(), `gpu-search-secret-${Date.now()}.txt`);
  fs.writeFileSync(tmp, '  top-secret-value\n');
  const priorFile = process.env.EBAY_CLIENT_SECRET_FILE;
  const priorValue = process.env.EBAY_CLIENT_SECRET;
  try {
    process.env.EBAY_CLIENT_SECRET_FILE = tmp;
    delete process.env.EBAY_CLIENT_SECRET;
    resolveSecretFileOverrides();
    assert.equal(process.env.EBAY_CLIENT_SECRET, 'top-secret-value');
  } finally {
    fs.rmSync(tmp, { force: true });
    if (priorFile === undefined) delete process.env.EBAY_CLIENT_SECRET_FILE;
    else process.env.EBAY_CLIENT_SECRET_FILE = priorFile;
    if (priorValue === undefined) delete process.env.EBAY_CLIENT_SECRET;
    else process.env.EBAY_CLIENT_SECRET = priorValue;
  }
});

test('resolveSecretFileOverrides throws when the secret file is missing', () => {
  const priorFile = process.env.DISCORD_BOT_TOKEN_FILE;
  try {
    process.env.DISCORD_BOT_TOKEN_FILE = '/nonexistent/gpu-search/secret';
    assert.throws(() => resolveSecretFileOverrides());
  } finally {
    if (priorFile === undefined) delete process.env.DISCORD_BOT_TOKEN_FILE;
    else process.env.DISCORD_BOT_TOKEN_FILE = priorFile;
  }
});
