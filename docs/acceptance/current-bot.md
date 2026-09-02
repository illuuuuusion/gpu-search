# Abnahme des bestehenden `gpu-search`-Bots (Phase 0)

Diese Datei ist das Abnahmeprotokoll aus Phase 0 des Umsetzungsplans
`gpu-search-claude-discord-umsetzungsplan-ein-bot.md`.

**Phase 0 gilt erst als abgeschlossen, wenn auch der manuelle Teil unten abgehakt ist.**
Erst danach darf Phase 1 (Architektur-/Sicherheitsgerüst) begonnen werden.

---

## 1. Automatisiert abgenommen

Stand: **2026-09-02**, Branch `main`, Ausgangscommit `257d640`, Node v22.

| Prüfung | Ergebnis |
|---|---|
| `npm run lint` (`tsc --noEmit`) | grün |
| `npm run build` | grün |
| `npm test` | **74/74 grün** (73 bestehende + 1 neuer Konkurrenztest) |
| Persistenzfehler in der Testausgabe | **keine** (vorher: wiederholtes `ENOENT` beim `rename`) |
| `npm audit --omit=dev` | **0 Findings** (vorher: 6, davon 4 `high`) |
| `npm audit --omit=dev --audit-level=high` als CI-Gate | Exit 0 |
| Backup-Rotation | unverändert korrekt (bestehende Tests grün) |

### 1.1 Behobene Race Condition

`src/app/shared/atomicFile.ts` verwendete pro Zieldatei einen festen `.tmp`-Pfad.
Parallele Writes nahmen sich gegenseitig die Temp-Datei weg.

Behoben durch:

1. eindeutigen Temp-Pfad pro Schreibvorgang (PID + `crypto.randomUUID()`);
2. Serialisierung aller Writes pro Zielpfad, sodass Backup-Rotation und Hauptwrite
   als **eine** Operation laufen;
3. `fsync` auf Datei und (best effort) Parent-Directory vor/nach dem `rename`;
4. Aufräumen der Temp-Datei im `finally`.

Regressionstest: `writeFileAtomic survives 20 concurrent writes to the same target`
in `src/app/shared/atomicFile.test.ts`.

> **Gegenprobe durchgeführt:** Gegen die alte Implementierung schlägt dieser Test
> mit genau dem im Plan dokumentierten `ENOENT: rename '...state.json.tmp'` fehl.
> Der Test ist damit nachweislich ein echter Regressionsschutz.

**Bekannte Grenze:** Die Serialisierung ist *prozesslokal*. Zwei parallele
`gpu-search`-Prozesse auf derselben State-Datei bräuchten ein echtes Lockfile.
Der eindeutige Temp-Pfad verhindert dort immerhin das gegenseitige `ENOENT`.
Der aktuelle Betrieb ist Single-Process, daher ausreichend.

### 1.2 Hinweis zu Persistenzwarnungen in Tests

Plan-Punkt 0.1.6 verlangt, dass Tests Persistenzwarnungen nicht still als Erfolg
akzeptieren. Umgesetzt wurde die **stärkere** Variante: der neue Test prüft direkt
an der Quelle (`writeFileAtomic`), dass *kein einziger* Write rejected, statt
Logausgaben nachträglich zu durchsuchen.

Die `catch`-und-`logger.warn`-Blöcke in den Aufrufern (z. B. `aliasFallback.ts`)
bleiben bewusst erhalten: ein fehlgeschlagener Persist darf den laufenden Scanner
nicht abbrechen. Das ist gewolltes Produktionsverhalten, kein stiller Testfehler.

---

## 2. Manuell offen — **muss von Hand in Discord abgenommen werden**

Diese Punkte kann keine CI und keine Coding-KI abnehmen. Sie brauchen einen
laufenden Bot mit echtem Token, echtem Discord-Server und echten eBay-Daten.
Reihenfolge wie im Plan (0.3.2). Details je Punkt in [`TODO-USER.md`](../../TODO-USER.md).

- [ ] **Reactions + Allowlist** — `REACTIONS_ENABLED=true` setzen; Reaktion eines
      erlaubten Accounts wirkt, Reaktion eines fremden Accounts wird still ignoriert.
      Datum: ____________  Ergebnis: ____________
- [ ] **C2 Fehltreffer** — 🚫 auf einen Alert, Ausschlussbegriff im Dialog setzen;
      zu alias-naher Begriff wird abgelehnt, spezifischer Begriff geht durch.
      Datum: ____________  Ergebnis: ____________
- [ ] **C1 Dream Deal** — Schwelle `DREAM_DEAL_MIN_SCORE` über 🔥/🧊 nachjustieren.
      Datum: ____________  Ergebnis: ____________
- [ ] **D Auktions-Reminder inkl. Neustart** — Reminder auf echte Auktion setzen,
      Prozess neu starten, prüfen dass der Reminder den Neustart überlebt.
      Datum: ____________  Ergebnis: ____________
- [ ] **B2 Deal-Timing** — erst nach ausreichender eigener Laufzeit-Historie bewerten.
      Datum: ____________  Ergebnis: ____________
- [ ] **B6 Alias-Log beobachten** — reale Treffer im Log prüfen, noch kein Live-Alarm.
      Datum: ____________  Ergebnis: ____________

### Bewusst nicht abgenommen

- **B4 Kleinanzeigen-Arbitrage:** Feature-Flag bleibt `false`, bis Recht/ToS geklärt
  und die Live-Selektoren geprüft sind. Nicht aktivieren.
- **A6 Liquipedia:** wird nicht umgesetzt. Siehe Abschnitt 3.

---

## 3. Entscheidung A6 / Liquipedia

Der Liquipedia-MediaWiki-Client war toter Code: nirgends instanziiert, und
`'liquipedia'` war nicht einmal ein gültiger Wert des Enums
`VALORANT_PROVIDER` (`'vlr' | 'grid'`). Aktiver Provider ist und bleibt VLR.

**Entfernt** (Plan 0.3.4, Variante „toten Code entfernen"):

- `src/domains/valorant/ingest/sources/liquipediaMediaWikiClient.ts`
- die zugehörigen Env-Variablen `VALORANT_LIQUIPEDIA_API_BASE_URL`,
  `VALORANT_LIQUIPEDIA_USER_AGENT`, `VALORANT_LIQUIPEDIA_MIN_REQUEST_INTERVAL_MS`
  inklusive ihrer Typdeklarationen

**Bewusst behalten:** `LiquipediaTournamentSeed` (`domain/models.ts`) und
`VALORANT_TOURNAMENT_SEEDS` (`config/tournaments.ts`). Das ist eine reine
Turnier-Datenliste ohne Netzwerkzugriff. Der Name ist historisch; die
ToS-/API-Konformitätsfrage aus A6 betraf ausschließlich den entfernten Client.

---

## 4. Repository-Hygiene (Plan 0.2)

| Maßnahme | Status |
|---|---|
| `node_modules/` aus dem Git-Index entfernt | 4.866 Dateien, Dateien bleiben auf der Platte |
| `dist/` aus dem Git-Index entfernt | 4 Dateien |
| `matrix-bot.json` aus dem Git-Index entfernt + in `.gitignore` | erledigt |
| `.gitignore` | unverändert gültig, um `matrix-bot.json` und `.DS_Store` ergänzt |
| `engines.node` passend zum Dockerfile (`node:22-bookworm-slim`) | `">=22 <23"` |
| Node-Version in CI gepinnt | `node-version: '22'` |
| `PLAN.md` archiviert | → `docs/archive/PLAN.md`, mit Status-Header |
| `TODO-USER.md` als Abnahmecheckliste behalten | unverändert |

### Prüfung `matrix-bot.json`

Inhalt sind ausschließlich `syncToken`, `filter: null` sowie die leeren Objekte
`appserviceUsers`, `appserviceTransactions` und `kvStore`.

**Kein Credential, kein Token, kein Zugangsschlüssel** — nur ein Matrix-Sync-Cursor,
also Laufzeitstate. Eine Credential-Rotation ist daher **nicht** erforderlich.
Die Datei wurde aus dem Index entfernt und ignoriert; sie wird zur Laufzeit neu
erzeugt. Ein Verlust des Sync-Tokens führt lediglich zu einem einmaligen Full-Sync.

---

## 5. Nicht verifiziert

- Der frische-Clone-Durchlauf (`git clone` → `npm ci` → `npm run lint` → `npm test`)
  ist erst nach dem Commit der Phase-0-Änderungen aussagekräftig und steht noch aus.
- Die CI-Pipeline (`.github/workflows/ci.yml`) wurde lokal nachgestellt (alle vier
  Schritte grün), aber noch nicht auf GitHub ausgeführt.
