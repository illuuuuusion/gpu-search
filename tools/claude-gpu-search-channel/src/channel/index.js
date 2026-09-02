import readline from 'node:readline';

// stdio-Kanal zu Claude Code: newline-delimitiertes JSON auf stdin/stdout.
// ACHTUNG: Die Frame-Namen unten sind gegen den gepinnten Upstream-Commit des
// offiziellen Discord-Plugins abzugleichen (siehe README, "Upstream-Pins"),
// bevor der Sidecar produktiv gegen Claude Code laeuft.
export class StdioChannel {
  constructor({ input = process.stdin, output = process.stdout, onFrame } = {}) {
    this.output = output;
    this.onFrame = onFrame ?? (() => {});
    this.reader = readline.createInterface({ input, crlfDelay: Infinity });
    this.reader.on('line', line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let frame;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        this.send({ type: 'error', error: 'invalid json frame' });
        return;
      }
      void this.onFrame(frame);
    });
  }

  send(frame) {
    this.output.write(`${JSON.stringify(frame)}\n`);
  }

  close() {
    this.reader.close();
  }
}
