import crypto from 'node:crypto';

// Serverseitige, unveraenderliche Identitaet einer freigegebenen Discord-Nachricht.
// Nur `requestId` wird an den Sidecar/Claude weitergereicht -- Absender, Guild und
// Kanal werden hier wieder aufgeloest und koennen vom Modell nicht gesetzt werden.
export interface RequestContext {
  readonly requestId: string;
  readonly userId: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly expiresAt: number;
}

export interface RequestContextInput {
  userId: string;
  guildId: string;
  channelId: string;
  messageId: string;
}

export class RequestContextStore {
  private readonly contexts = new Map<string, RequestContext>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: RequestContextInput): RequestContext {
    this.prune();
    const createdAt = this.now();
    const context: RequestContext = Object.freeze({
      requestId: crypto.randomUUID(),
      ...input,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: createdAt + this.ttlSeconds * 1000,
    });
    this.contexts.set(context.requestId, context);
    return context;
  }

  get(requestId: string): RequestContext | undefined {
    const context = this.contexts.get(requestId);
    if (!context) {
      return undefined;
    }

    if (context.expiresAt <= this.now()) {
      this.contexts.delete(requestId);
      return undefined;
    }

    return context;
  }

  // ponytail: lineares Aufraeumen beim Anlegen statt Timer. Ceiling: bei sehr
  // vielen offenen Kontexten pro Tick auf einen Heap/Timer umstellen.
  prune(): void {
    const now = this.now();
    for (const [id, context] of this.contexts) {
      if (context.expiresAt <= now) {
        this.contexts.delete(id);
      }
    }
  }

  get size(): number {
    return this.contexts.size;
  }
}
