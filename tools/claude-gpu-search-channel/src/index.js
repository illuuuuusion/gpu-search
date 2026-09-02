import fs from 'node:fs';
import { StdioChannel } from './channel/index.js';
import { SocketClient } from './socketClient/index.js';
import { TOOL_DEFINITIONS, createToolHandlers } from './tools/index.js';

// Harte Grenze: der Sidecar darf niemals Discord-Zugangsdaten sehen. Wer ihn mit
// vererbtem Bot-Token startet, bekommt keinen halb sicheren Betrieb, sondern Exit 1.
export function assertNoDiscordCredentials(environment = process.env) {
  const forbidden = Object.keys(environment).filter(name => /^DISCORD_(BOT_TOKEN|TOKEN)(_FILE)?$/.test(name));
  if (forbidden.length > 0) {
    throw new Error(`sidecar must not inherit discord credentials: ${forbidden.join(', ')}`);
  }
}

export function readSecret(environment = process.env) {
  const file = environment.AI_SOCKET_SECRET_FILE;
  if (!file) {
    throw new Error('AI_SOCKET_SECRET_FILE is required');
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export async function main(environment = process.env) {
  assertNoDiscordCredentials(environment);

  const socketClient = new SocketClient({
    socketPath: environment.AI_SOCKET_PATH ?? 'data/runtime/claude-channel.sock',
    secret: readSecret(environment),
    onInbound: frame => channel.send({ type: 'channel_message', requestId: frame.requestId, text: frame.text }),
    onApprovalStatus: frame => channel.send({ type: 'approval_status', ...frame }),
    onClose: () => channel.send({ type: 'channel_status', connected: false }),
  });

  const handlers = createToolHandlers(socketClient);
  const channel = new StdioChannel({
    onFrame: async frame => {
      if (frame.type === 'list_tools') {
        channel.send({ type: 'tools', id: frame.id, tools: TOOL_DEFINITIONS });
        return;
      }

      const handler = handlers[frame.type];
      if (!handler) {
        channel.send({ type: 'result', id: frame.id, ok: false, error: `unknown tool: ${frame.type}` });
        return;
      }

      try {
        channel.send({ type: 'result', id: frame.id, ok: true, result: await handler(frame) });
      } catch (error) {
        channel.send({ type: 'result', id: frame.id, ok: false, error: error.message });
      }
    },
  });

  await socketClient.connect();
  channel.send({ type: 'channel_status', connected: true });

  const shutdown = () => {
    socketClient.close();
    channel.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
