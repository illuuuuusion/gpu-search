import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { env, resolveSecretFileOverrides, validateAiAgentConfig, type AppEnv } from './index.js';

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

function aiEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    ...env,
    AI_AGENT_ENABLED: true,
    AI_GUILD_ID: 'guild-1',
    AI_SOCKET_SECRET: 'local-secret',
    AI_ALLOWED_USER_IDS: 'user-1',
    AI_OWNER_USER_IDS: 'owner-1',
    AI_ALLOWED_CHANNEL_IDS: 'chan-1',
    ...overrides,
  };
}

test('validateAiAgentConfig accepts a complete configuration', () => {
  const config = validateAiAgentConfig(aiEnv());
  assert.deepEqual([...config.ownerUserIds], ['owner-1']);
  assert.equal(config.guildId, 'guild-1');
});

test('an enabled ai agent without guild, allowlists or socket secret fails hard', () => {
  const cases: [Partial<AppEnv>, RegExp][] = [
    [{ AI_GUILD_ID: undefined }, /AI_GUILD_ID/],
    [{ AI_SOCKET_SECRET: undefined }, /AI_SOCKET_SECRET_FILE/],
    [{ AI_ALLOWED_USER_IDS: '' }, /AI_ALLOWED_USER_IDS/],
    [{ AI_OWNER_USER_IDS: '  ,  ' }, /AI_OWNER_USER_IDS/],
    [{ AI_ALLOWED_CHANNEL_IDS: '' }, /AI_ALLOWED_CHANNEL_IDS/],
  ];

  for (const [overrides, expected] of cases) {
    assert.throws(() => validateAiAgentConfig(aiEnv(overrides)), expected);
  }
});
