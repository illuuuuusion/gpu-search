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
  scripts/
    gpu/
    valorant/
    ops/
```

## Schnellstart

1. Abhängigkeiten installieren
   ```bash
   npm install
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
4. Entwicklung starten
   ```bash
   npm run dev
   ```

## Lokale Tests

- Ein end-to-end Mock-Scan mit Discord oder Console und frischem Test-State:
  ```bash
  npm run build
  npm run test:mock-scan
  ```
- Optional nur für ein Modell:
  ```bash
  TEST_PROFILE_NAME="RTX 5080" npm run test:mock-scan
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

## Was ich als Nächstes ergänzen würde

1. Persistenz in SQLite statt JSON, wenn die Beobachtungshistorie größer wird
2. Mehr Suchbegriffe pro Profil statt nur Primäralias
3. Verbesserte VRAM-Erkennung aus Titel + Artikelmerkmalen
4. tägliche Zusammenfassung zusätzlich zu Sofort-Alerts
5. Dashboard/API mit Fastify + einfachem Frontend
6. Historische Preis-DB für längere Trends und Preis/Performance-Scoring

## Hinweise

- Für produktive Nutzung solltest du Rate Limits, Retry-Strategien und dedizierte Speicherung ergänzen.
- Die Benachrichtigungen enthalten absichtlich keinen eBay-Verkäufer-Usernamen, damit keine eBay-Nutzerkennung in externen Alert-Kanälen wie Discord weiterverbreitet wird.
