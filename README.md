# gpu-search

`gpu-search` ist ein kleiner Node.js/TypeScript-Scanner fuer GPU-Deals auf eBay. Er durchsucht definierte GPU-Profile in festen Intervallen, filtert unpassende oder zu teure Angebote heraus und meldet passende Treffer an Discord oder als Konsolen-Alert.

Node.js/TypeScript-Grundgerüst für eine GPU-Watchlist mit:

- eBay Browse API als Datenquelle
- konfigurierbaren GPU-Profilen
- 5 breite Such-Buckets statt ein API-Call pro Modell
- Defekt-/Ausschlussfilter
- Preis- und Versandlogik
- Discord-Benachrichtigungen oder Console-Fallback
- persistente Scanner-Historie für `seen`, Durchschnittsscores und Durchschnittspreise

## Warum diese Architektur?

- **eBay Browse API** statt Scraping: stabiler, strukturierte Felder für Preis, Versand, Verkäufer, Buying Options.
- **Discord** als Notifier: einfacher Alert-Kanal für akzeptierte Treffer per Bot-Token und Channel-ID.
- **Profile JSON**: Preisgrenzen und Modelle sind ohne Codeänderung pflegbar.
- **Bucket-Suche + lokales Matching**: spart API-Calls und verschiebt die Feinarbeit in den eigenen Filter.
- **Scanner-State**: merkt sich gesendete Listings und baut rollierende Marktmittelwerte pro GPU-Profil auf.

## Projektstruktur

```txt
src/
  app/
    bootstrap.ts
    env/
    shared/
  domains/
    gpu/
      application/
      config/
      domain/
      infrastructure/
    valorant/
  integrations/
    discord/
      ai/          # KI-Agent: Socket, Policy, Freigaben, Audit
      routing/     # Message-/Reaction-Dispatch
      runtime/     # einziger Discord-Client + login()
  scripts/
    gpu/
    valorant/
    ops/
tools/
  claude-gpu-search-channel/   # Claude-Channel-Sidecar (ohne Discord-Token)
```

## Schnellstart

Voraussetzung: **Node.js 22** (siehe `engines` in der `package.json` und das Dockerfile).

1. Abhängigkeiten installieren
   ```bash
   npm ci
   ```
2. Umgebungsvariablen setzen
   ```bash
   cp .env.example .env
   ```
3. Werte in `.env` eintragen
   - Fuer einen lokalen Test ohne eBay-Zugang `EBAY_PROVIDER=mock` lassen
   - Fuer einen lokalen Test mit echten eBay-Sandbox-Keys `EBAY_PROVIDER=sandbox` setzen
   - Fuer den Live-Betrieb `EBAY_PROVIDER=live` setzen und `EBAY_APP_ID` plus `EBAY_CLIENT_SECRET` eintragen
   - Fuer lokale Tests `NOTIFIER_PROVIDER=console` lassen
   - Fuer Discord `NOTIFIER_PROVIDER=discord` setzen und `DISCORD_BOT_TOKEN` plus `DISCORD_CHANNEL_ID` eintragen
   - Scanner-`seen` und Marktstatistiken landen unter `data/scanner-state.json`
   - `DISCORD_BOT_TOKEN` und `EBAY_CLIENT_SECRET` lassen sich statt direkt auch per
     Datei setzen — `DISCORD_BOT_TOKEN_FILE` bzw. `EBAY_CLIENT_SECRET_FILE` zeigen
     dann auf die Datei (z. B. `/run/secrets/...`), passend für Docker-Secrets.
     Secrets werden in Logs über `pino`-`redact` maskiert.
4. Entwicklung starten
   ```bash
   npm run dev
   ```

## Lokale Tests

- Typecheck und Testsuite (läuft ohne echten eBay- oder Discord-Zugang):
  ```bash
  npm run lint   # tsc --noEmit
  npm test       # Build + node:test, aktuell 74 Tests
  ```
- Audit der Produktionsabhängigkeiten:
  ```bash
  npm audit --omit=dev --audit-level=high
  ```
- Ein end-to-end Mock-Scan mit Discord oder Console und frischem Test-State:
  ```bash
  npm run build
  npm run test:mock-scan
  ```
- Optional nur für ein Modell:
  ```bash
  TEST_PROFILE_NAME="RTX 5080" npm run test:mock-scan
  ```

## Observability (optional)

Mit `OTEL_ENABLED=true` startet ein lokaler Prometheus-Endpunkt (Default-Port
`9464`). Metriken (u. a. `ebay_http_retries_total`, `ebay_http_rate_limit_hits_total`,
`ebay_http_errors_total`, `discord_send_throttle_waits_total`) sowie Spans für
GPU-Scan- und Valorant-Sync-Ticks lassen sich so scrapen:

```bash
OTEL_ENABLED=true npm start
curl localhost:9464/metrics
```

## Was schon implementiert ist

- OAuth für eBay
- Suche über `item_summary/search`
- 5 Bucket-Abfragen mit Pagination statt Einzelabfragen pro Profil
- Mapping auf internes Listing-Modell
- lokales Matching der Listings auf GPU-Profile
- zusätzliches Matching über `subtitle`, `shortDescription` und eBay-`localizedAspects`
- Filterung nach:
  - Verkäuferbewertung
  - erlaubten Ländern
  - Ausschlussbegriffen
  - Defektbegriffen aus Titel, Zustand, Merkmalen und Rohdaten
  - Versandkosten-Regel
  - Preislimit je Angebotsart
  - Auktionsrestzeit unter 5 Stunden
- Discord-Notifier
- erweiterte Board-/Modellerkennung aus `localizedAspects`, Descriptor-/Property-Feldern und Beschreibungstexten
- persistente `seen`-Speicherung und rollierende Durchschnittswerte für Score, Gebraucht- und Defektpreise
- **Retries und Rate-Limit-Handling** für eBay-HTTP-Calls sowie Sende-Throttling für Discord
- **atomare State-Writes mit Backup-Rotation** (`src/app/shared/atomicFile.ts`);
  Writes sind pro Zieldatei serialisiert, Temp-Dateien eindeutig pro Schreibvorgang
- **Secrets aus Dateien** (`*_FILE`) und Log-Redaction über `pino`
- **Reaction-Infrastruktur mit Allowlist**: 👍/👎/🚫/⏰/🔥/🧊 auf Alerts, Reaktionen
  nicht erlaubter Accounts werden still ignoriert (`REACTIONS_ENABLED`)
- adaptive Akzeptanzschwelle und Dream-Deal-Score, per Reaction nachjustierbar
- Fehltreffer-Meldung mit profil-spezifischen Laufzeit-Ausschlüssen
  (`data/runtime-exclusions.json`, `/exclusions review|undo`)
- Auktions-Reminder, die einen Prozess-Neustart überleben
- Valorant-Domain (VLR als Provider) mit eigenem Sync-Scheduler und Fehlerisolation
- OpenTelemetry-/Prometheus-Metriken und Spans (siehe oben)
- Property-based Tests via `fast-check`

## Aktuelle Grenzen

- **Version `0.1.0`, kein produktiver Deployment-Prozess.** Der Funktionsumfang ist
  weitgehend vollständig, aber mehrere Features sind noch nicht mit echten Discord-
  und eBay-Daten abgenommen — offene Punkte in [`TODO-USER.md`](TODO-USER.md),
  Protokoll in [`docs/acceptance/current-bot.md`](docs/acceptance/current-bot.md).
- **B4 (Kleinanzeigen-Arbitrage)** ist nur ein Codegerüst und per Feature-Flag
  deaktiviert. Nicht aktivieren, solange ToS-Frage und Live-Selektoren offen sind.
- **A6 (Liquipedia)** wird nicht umgesetzt; der tote Client wurde entfernt.
  Aktiver Valorant-Provider ist VLR.
- **Persistenz ist JSON, kein DBMS.** Die Write-Serialisierung ist prozesslokal —
  der Betrieb ist auf einen einzelnen `gpu-search`-Prozess pro State-Datei ausgelegt.
- `B2` (Deal-Timing) wird erst mit genügend eigener Laufzeit-Historie aussagekräftig.
- **Der KI-Agent kann bisher nur lesen** (`AI_AGENT_ENABLED=false` als Default).
  Policy, Freigaben, Audit, Allowlists, Socket und 14 begrenzte Read-Tools stehen;
  schreibende und destruktive Werkzeuge sind **nicht registrierbar**.
  Details in [`docs/ai-agent/`](docs/ai-agent/architecture.md).

## Was ich als Nächstes ergänzen würde

1. Persistenz in SQLite statt JSON, wenn die Beobachtungshistorie größer wird
2. Mehr Suchbegriffe pro Profil statt nur Primäralias
3. Verbesserte VRAM-Erkennung aus Titel + Artikelmerkmalen
4. tägliche Zusammenfassung zusätzlich zu Sofort-Alerts
5. Dashboard/API mit Fastify + einfachem Frontend
6. Historische Preis-DB für längere Trends und Preis/Performance-Scoring

## Hinweise

- Rate-Limit- und Retry-Behandlung sind implementiert. Für den produktiven Dauerbetrieb
  bleibt vor allem die Ablösung der JSON-Persistenz durch eine echte Datenbank offen.
- Die Benachrichtigungen enthalten absichtlich keinen eBay-Verkäufer-Usernamen, damit keine eBay-Nutzerkennung in externen Alert-Kanälen wie Discord weiterverbreitet wird.
