import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { logger } from '../../../app/shared/logger.js';
import type { RequestContext } from './requestContextStore.js';

const MAX_FRAME_BYTES = 256 * 1024;

export interface AgentSocketHandlers {
  reply(input: { requestId: string; content: string }): Promise<{ messageId: string }>;
  react(input: { requestId: string; emoji: string; messageId?: string }): Promise<void>;
  editMessage(input: { requestId: string; messageId: string; content: string }): Promise<void>;
  adminTool(input: {
    requestId: string;
    toolName: string;
    args?: Record<string, unknown>;
    approvalId?: string;
  }): Promise<unknown>;
  health(): Promise<Record<string, unknown>>;
}

export interface AgentSocketServerOptions {
  socketPath: string;
  secret: string;
  handlers: AgentSocketHandlers;
}

function secretsMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') {
    return false;
  }
  // Hash-Vergleich: konstante Laenge, damit timingSafeEqual nicht wirft und
  // die Secret-Laenge nicht ueber die Fehlermeldung leakt.
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(received).digest();
  return crypto.timingSafeEqual(a, b);
}

// Lokaler Unix-Socket zum Claude-Channel-Sidecar. Kein TCP-Port, keine
// Discord-Zugangsdaten nach aussen -- der Sidecar bekommt nur Request-IDs.
export class AgentSocketServer {
  private server: net.Server | null = null;
  private client: net.Socket | null = null;

  constructor(private readonly options: AgentSocketServerOptions) {}

  get connected(): boolean {
    return Boolean(this.client && !this.client.destroyed);
  }

  async start(): Promise<void> {
    const socketPath = path.resolve(this.options.socketPath);
    await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await fs.rm(socketPath, { force: true }); // verwaisten Socket eines Vorlaufs entfernen

    const server = net.createServer(socket => this.handleConnection(socket));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    await fs.chmod(socketPath, 0o600);
    server.on('error', error => logger.error({ error }, 'agent socket server error'));
    logger.info({ socketPath }, 'agent socket server listening');
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await fs.rm(path.resolve(this.options.socketPath), { force: true });
  }

  sendInboundMessage(context: RequestContext, text: string): void {
    this.send({
      type: 'inbound_message',
      requestId: context.requestId,
      channelId: context.channelId,
      text,
    });
  }

  sendApprovalStatus(input: { requestId: string; approvalId: string; status: string }): void {
    this.send({ type: 'approval_status', ...input });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.client || this.client.destroyed) {
      logger.warn({ type: payload.type }, 'no agent sidecar connected; dropping frame');
      return;
    }
    this.client.write(`${JSON.stringify(payload)}\n`);
  }

  private handleConnection(socket: net.Socket): void {
    // ponytail: genau ein Sidecar. Eine zweite Verbindung ersetzt die alte,
    // statt eine Session-Verwaltung einzufuehren.
    this.client?.destroy();
    this.client = socket;

    let authenticated = false;
    let buffer = '';

    socket.setEncoding('utf8');
    socket.on('error', error => logger.warn({ error }, 'agent socket connection error'));
    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
      }
    });

    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > MAX_FRAME_BYTES) {
        logger.warn('agent socket frame too large; closing connection');
        socket.destroy();
        return;
      }

      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) {
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(line) as Record<string, unknown>;
          } catch {
            socket.destroy();
            return;
          }

          if (!authenticated) {
            if (frame.type !== 'auth' || !secretsMatch(this.options.secret, frame.secret)) {
              logger.warn('agent socket authentication failed');
              socket.end(`${JSON.stringify({ type: 'auth_result', ok: false })}\n`);
              socket.destroy();
              return;
            }
            authenticated = true;
            socket.write(`${JSON.stringify({ type: 'auth_result', ok: true })}\n`);
          } else {
            void this.handleFrame(socket, frame);
          }
        }
        index = buffer.indexOf('\n');
      }
    });
  }

  private async handleFrame(socket: net.Socket, frame: Record<string, unknown>): Promise<void> {
    const id = typeof frame.id === 'string' ? frame.id : undefined;
    const requestId = typeof frame.requestId === 'string' ? frame.requestId : '';
    const respond = (payload: Record<string, unknown>): void => {
      if (!socket.destroyed) {
        socket.write(`${JSON.stringify({ type: 'result', id, ...payload })}\n`);
      }
    };

    try {
      const handlers = this.options.handlers;
      switch (frame.type) {
        case 'reply':
          respond({ ok: true, result: await handlers.reply({ requestId, content: String(frame.content ?? '') }) });
          return;
        case 'react':
          await handlers.react({
            requestId,
            emoji: String(frame.emoji ?? ''),
            messageId: typeof frame.messageId === 'string' ? frame.messageId : undefined,
          });
          respond({ ok: true });
          return;
        case 'edit_message':
          await handlers.editMessage({
            requestId,
            messageId: String(frame.messageId ?? ''),
            content: String(frame.content ?? ''),
          });
          respond({ ok: true });
          return;
        case 'admin_tool_request':
          respond({
            ok: true,
            result: await handlers.adminTool({
              requestId,
              toolName: String(frame.toolName ?? ''),
              args: (frame.args as Record<string, unknown> | undefined) ?? {},
              approvalId: typeof frame.approvalId === 'string' ? frame.approvalId : undefined,
            }),
          });
          return;
        case 'health':
          respond({ ok: true, result: await handlers.health() });
          return;
        default:
          respond({ ok: false, error: `unknown frame type: ${String(frame.type)}` });
      }
    } catch (error) {
      logger.error({ error, frameType: frame.type }, 'agent socket frame failed');
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
