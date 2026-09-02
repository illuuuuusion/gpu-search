import net from 'node:net';

// Newline-delimitiertes JSON zum gpu-search-Hauptprozess. Der Sidecar kennt
// weder Discord-Token noch Discord-API -- nur diesen lokalen Socket.
export class SocketClient {
  #socket = null;
  #buffer = '';
  #pending = new Map();
  #nextId = 1;
  #authenticated = false;
  #authResolve = null;
  #authReject = null;

  constructor({ socketPath, secret, onInbound, onApprovalStatus, onClose }) {
    this.socketPath = socketPath;
    this.secret = secret;
    this.onInbound = onInbound ?? (() => {});
    this.onApprovalStatus = onApprovalStatus ?? (() => {});
    this.onClose = onClose ?? (() => {});
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      this.#socket = socket;
      socket.setEncoding('utf8');
      socket.once('error', reject);
      socket.on('data', chunk => this.#onData(chunk));
      socket.on('close', () => {
        this.#authenticated = false;
        for (const { reject: rejectPending } of this.#pending.values()) {
          rejectPending(new Error('socket closed'));
        }
        this.#pending.clear();
        this.onClose();
      });
      socket.on('connect', () => {
        socket.removeListener('error', reject);
        this.#authResolve = resolve;
        this.#authReject = reject;
        this.#write({ type: 'auth', secret: this.secret });
      });
    });
  }

  get connected() {
    return this.#authenticated;
  }

  close() {
    this.#socket?.end();
  }

  // Request/Response mit Korrelations-ID; der Server antwortet mit type "result".
  request(type, payload = {}) {
    if (!this.#authenticated) {
      return Promise.reject(new Error('socket is not authenticated'));
    }

    const id = String(this.#nextId++);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#write({ type, id, ...payload });
    });
  }

  #write(frame) {
    this.#socket?.write(`${JSON.stringify(frame)}\n`);
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let index = this.#buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) {
        this.#onFrame(JSON.parse(line));
      }
      index = this.#buffer.indexOf('\n');
    }
  }

  #onFrame(frame) {
    if (frame.type === 'auth_result') {
      this.#authenticated = Boolean(frame.ok);
      if (frame.ok) this.#authResolve?.();
      else this.#authReject?.(new Error('socket authentication rejected'));
      return;
    }

    if (frame.type === 'inbound_message') {
      this.onInbound(frame);
      return;
    }

    if (frame.type === 'approval_status') {
      this.onApprovalStatus(frame);
      return;
    }

    if (frame.type === 'result' && frame.id) {
      const pending = this.#pending.get(frame.id);
      this.#pending.delete(frame.id);
      if (!pending) return;
      if (frame.ok) pending.resolve(frame.result ?? null);
      else pending.reject(new Error(frame.error ?? 'tool call failed'));
    }
  }
}
