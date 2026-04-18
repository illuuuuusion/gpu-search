# gpu-search

`gpu-search` ist ein kleiner Node.js/TypeScript-Scanner fuer GPU-Deals auf eBay. Er durchsucht definierte GPU-Profile in festen Intervallen, filtert unpassende oder zu teure Angebote heraus und meldet passende Treffer an Matrix oder als Konsolen-Alert.

Node.js/TypeScript-Grundgerüst für eine GPU-Watchlist mit:

- eBay Browse API als Datenquelle
- eBay Marketplace-Account-Deletion-Webhook fuer Production-Freischaltung
- konfigurierbaren GPU-Profilen
- 5 breite Such-Buckets statt ein API-Call pro Modell
- Defekt-/Ausschlussfilter
- Preis- und Versandlogik
- Matrix-Benachrichtigungen oder Console-Fallback

## Warum diese Architektur?

- **eBay Browse API** statt Scraping: stabiler, strukturierte Felder für Preis, Versand, Verkäufer, Buying Options.
- **Matrix** als Notifier: selbst hostbar, private Direktnachrichten oder eigene Räume möglich.
- **Profile JSON**: Preisgrenzen und Modelle sind ohne Codeänderung pflegbar.
- **Bucket-Suche + lokales Matching**: spart API-Calls und verschiebt die Feinarbeit in den eigenen Filter.

## Projektstruktur

```txt
config/
  gpu-profiles.json
src/
  config/
  core/
  integrations/
    ebay/
    matrix/
  types/
  utils/
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
   - Fuer den Live-Betrieb `EBAY_PROVIDER=live` setzen und `EBAY_APP_ID` plus `EBAY_CLIENT_SECRET` eintragen
   - Fuer die Production-Freischaltung von eBay zusaetzlich `EBAY_NOTIFICATION_PUBLIC_URL` und `EBAY_NOTIFICATION_VERIFICATION_TOKEN` setzen
   - Wenn du nur den Freischaltungs-Webhook starten willst, `SCANNER_ENABLED=false` setzen
   - Fuer lokale Tests `NOTIFIER_PROVIDER=console` lassen
   - Fuer Matrix `NOTIFIER_PROVIDER=matrix` setzen und `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN` und `MATRIX_ROOM_ID` eintragen
4. Entwicklung starten
   ```bash
   npm run dev
   ```

## Was schon implementiert ist

- OAuth für eBay
- Suche über `item_summary/search`
- eingebauten Webhook fuer eBay Marketplace Account Deletion
- 5 Bucket-Abfragen mit Pagination statt Einzelabfragen pro Profil
- Mapping auf internes Listing-Modell
- lokales Matching der Listings auf GPU-Profile
- Filterung nach:
  - Verkäuferbewertung
  - erlaubten Ländern
  - Ausschlussbegriffen
  - Defektbegriffen
  - Versandkosten-Regel
  - Preislimit je Angebotsart
  - Auktionsrestzeit unter 5 Stunden
- Matrix-Notifier

## Was ich als Nächstes ergänzen würde

1. Persistenz für bereits gesehene Angebote (SQLite oder Postgres)
2. Mehr Suchbegriffe pro Profil statt nur Primäralias
3. Verbesserte VRAM-Erkennung aus Titel + Artikelmerkmalen
4. tägliche Zusammenfassung zusätzlich zu Sofort-Alerts
5. Dashboard/API mit Fastify + einfachem Frontend
6. Historische Preis-DB für Mittelwerte und Preis/Performance-Scoring

## Hinweise

- `matrix-bot-sdk` funktioniert gut für klassische Bots. Falls du später mehr Matrix-spezifische Kontrolle willst, kannst du auf `matrix-js-sdk` wechseln.
- Für produktive Nutzung solltest du Rate Limits, Retry-Strategien und dedizierte Speicherung ergänzen.

## eBay-Production-Freischaltung

Damit eBay ein Production-Keyset aktiviert, musst du fuer `Marketplace Account Deletion` einen erreichbaren HTTPS-Webhook hinterlegen. Dieses Projekt kann den benoetigten Challenge-Handshake direkt selbst beantworten.

1. Setze in `.env` mindestens diese Werte:
   ```bash
   EBAY_PROVIDER=mock
   EBAY_NOTIFICATION_BIND_HOST=0.0.0.0
   EBAY_NOTIFICATION_PORT=3001
   EBAY_NOTIFICATION_PATH=/webhooks/ebay/marketplace-account-deletion
   EBAY_NOTIFICATION_PUBLIC_URL=https://deine-domain.tld/webhooks/ebay/marketplace-account-deletion
   EBAY_NOTIFICATION_VERIFICATION_TOKEN=dein_token_mit_32_bis_80_zeichen
   SCANNER_ENABLED=false
   ```
2. Starte das Projekt mit `npm run dev` oder `npm start`.
3. Sorge dafuer, dass deine Domain per HTTPS auf den lokalen Port `3001` zeigt. eBay akzeptiert kein `http`, kein `localhost` und keine interne IP.
4. Trage in der eBay-Developer-Oberflaeche dieselbe HTTPS-URL als Endpoint ein.
5. Trage denselben Verification Token ein und speichere. eBay ruft dann `GET <endpoint>?challenge_code=...` auf.
6. Wenn der Save-Vorgang erfolgreich ist, ist dein Endpoint verifiziert. Danach kannst du `Send Test Notification` nutzen.

Wichtig:

- Der Hash fuer `challengeResponse` wird aus `challengeCode + verificationToken + endpoint` gebildet, genau in dieser Reihenfolge.
- Die `EBAY_NOTIFICATION_PUBLIC_URL` muss exakt die URL sein, die du auch im eBay-Portal eintraegst.
- Der Webhook beantwortet `GET` fuer die Verifizierung und `POST` fuer spaetere Deletion-Notifications.
