> **ARCHIVIERT am 2026-09-02 — nicht erneut implementieren.**
>
> Dieser Plan ist abgearbeitet. Die Punkte A1-A5, A7, B2, B5, B6, C1, C2 und D sind im
> Code umgesetzt; A6 (Liquipedia) wurde bewusst verworfen, B4 (Kleinanzeigen) ist als
> Gerüst vorhanden und per Feature-Flag deaktiviert.
>
> Der Statussatz unten ("Entwurf, wartet auf Freigabe") ist historisch und **nicht** mehr gültig.
>
> - Offene manuelle Abnahmen: [`TODO-USER.md`](../../TODO-USER.md)
> - Abnahmeergebnisse: [`docs/acceptance/current-bot.md`](../acceptance/current-bot.md)
> - Aktueller Plan: `gpu-search-claude-discord-umsetzungsplan-ein-bot.md` (Phase 0 ff.)

---

# Umsetzungsplan gpu-search-Erweiterungen

Status: **Entwurf, wartet auf Freigabe.** Kein Code wurde im Rahmen dieses Plans geändert.

Alle Datei-/Feldnamen unten wurden durch Lesen des echten Repos verifiziert (nicht aus dem Auftrags-Prompt übernommen). Abweichungen zu den Annahmen im Auftrag sind explizit unter **„Abweichungen von den Annahmen"** je Punkt vermerkt.

## Wichtigste Abweichungen von den Ausgangsannahmen (zuerst lesen)

1. **Atomic Writes für `data/scanner-state.json` existieren bereits.** Commit `29aef66` hat `fs.writeFile(tmp) + fs.rename()` plus Batching (`beginBatch`/`commitBatch`) in `src/domains/gpu/domain/scannerState.ts:635-647` eingeführt. A2 muss also umskopiert werden: der reale Rückstand ist (a) `src/integrations/discord/adminState.ts` (schreibt `data/discord-admin-state.json` **nicht** atomar), (b) `src/domains/valorant/storage/fileRepository.ts` (schreibt `data/valorant-compositions.json` **nicht** atomar), (c) **keine Backup-Rotation** existiert irgendwo im Repo.
2. **Fehler-Isolation ist heute asymmetrisch, mit einem echten Bug.** Der GPU-Scheduler (`scanScheduler.ts`) hat bereits try/catch/finally pro Tick. Der Valorant-Scheduler (`syncScheduler.ts`) hat **keinerlei** try/catch um `runSync()` in seinem wiederkehrenden `setTimeout`-Callback — ein Fehler dort wird zur unhandled promise rejection (kein Logging, und je nach Node-Konfiguration potenziell Prozessabsturz). Zusätzlich: `bootstrap.ts:41` awaitet `gpuModule.start()` **ohne eigenes try/catch** — nur der äußere `bootstrap().catch(...)` fängt das ab und ruft `process.exit(1)`, was auch den bereits laufenden Valorant-Scheduler mit killt. Das ist kein hypothetisches Risiko, sondern ein bestehender Fehler in der Symmetrie der Fehlerbehandlung.
3. **Die zod-Fail-Fast-Validierung für Secrets existiert bereits** (`src/app/env/index.ts:133-150`, `requireValue()` wirft synchron beim ersten Import von `env/index.ts`, also vor jedem Notifier-Zugriff). Der reale Rückstand bei A1 ist **nur** noch: (a) Docker-Secrets-fähiges Einlesen (aktuell nur `process.env`, kein `*_FILE`-Mechanismus), (b) `pino`-`redact` (aktuell **nicht** konfiguriert — verifiziert, null Treffer für `redact` im gesamten `src/`).
4. **Der Liquipedia-Client ist toter Code.** `src/domains/valorant/ingest/sources/liquipediaMediaWikiClient.ts` hat bereits User-Agent-Header, ein Mindest-Request-Intervall und 429-Handling — wird aber **nirgends instanziiert**. Der aktive Provider ist VLR (`www.vlr.gg`, `src/domains/valorant/providers/vlr/provider.ts`), gesteuert über `VALORANT_PROVIDER: z.enum(['vlr','grid'])` — `'liquipedia'` ist nicht mal ein gültiger Enum-Wert. A6 („Liquipedia-API-Konformität") braucht daher eine explizite Entscheidung von dir, siehe offene Frage in A6.
5. **Reaction-Handling existiert im gesamten Repo nicht.** Kein `MessageReactionAdd`-Listener, kein `GatewayIntentBits.GuildMessageReactions` im Discord-Client-Intent-Set (`src/integrations/discord/notifier.ts:675-686`). Das ist die gemeinsame Grundlage für B5, C1, C2 und D — ich habe dafür einen neuen, im Original-Prompt nicht enthaltenen Punkt **A7 „Reaction-Infrastruktur & Allowlist"** ergänzt, der vor allen vieren stehen muss.
6. **Kein Allowlist-Mechanismus über Env existiert.** Es gibt nur ein hartcodiertes `DISCORD_ADMIN_USER_IDS`-Set (zwei User-IDs, `notifier.ts`) für Admin-Slash-Commands. `ALLOWED_REACTOR_IDS` aus dem Auftrag muss neu gebaut werden (Teil von A7).
7. **Keine Property-based-Test-Lib, kein dedizierter Test-Runner installiert.** Tests laufen über Node-Built-in `node:test` gegen kompilierte `dist/**/*.test.js` (Skript `test` in `package.json`). `fast-check` ist nicht installiert — muss als neue Dev-Dependency ergänzt werden.
8. **Keine OpenTelemetry-Pakete installiert.** `@opentelemetry/*` kommt in keiner `package.json`-Sektion vor — A3 ist eine vollständige Neuintegration.
9. **`itemEndDate` wird in `SeenRecord`/`ObservationRecord` aktuell nicht persistiert** (nur zur Scan-Zeit im `EbayListing`-Objekt vorhanden). Für D muss das Schema von `scanner-state.json` erweitert werden.
10. **eBay Marketplace Insights API (B2) erfordert laut eBay-Dokumentation eine gesonderte Freischaltung** des Entwickler-Accounts (nicht Teil der Standard-Buy-API-Scopes, die aktuell genutzt werden: nur Buy Browse API, `client.ts`). Das ist ein externes Risiko, keine reine Code-Frage — siehe offene Frage in B2.

---

## Vorgeschlagene Reihenfolge über alle Punkte

| # | Punkt | Kurzbegründung |
|---|-------|-----------------|
| 1 | A1 – Secrets-Handling | Unabhängig, geringes Risiko, sollte vor jedem Docker-Deploy-Schritt stehen. |
| 2 | A2 – Atomic Writes (erweitert) | Fundament: alle folgenden Punkte fügen neue mutable State-Felder hinzu (B5, C1, C2, D) — die schreiben sollen von Anfang an sicher sein. |
| 3 | A5 – Fehler-Isolation | Fundament: behebt einen bestehenden Bug (siehe Abweichung 2) und muss vor B5/D stehen, weil beide neue, wiederkehrende Scheduler-Ticks einführen. |
| 4 | A4 – Property-based Tests | Baut ein Sicherheitsnetz um `profileMatcher`/`aliasMatcher`/`filterEngine`/`repairabilityScore`, bevor C2 neue Vergleichslogik (Levenshtein) in genau diesem Bereich ergänzt. |
| 5 | A3 – Observability | Früh, wie im Auftrag begründet, damit B2/B4/B6/C1/C2/D von Anfang an Metriken haben. Nach den anderen Fundament-Punkten, weil sie zusätzliche Fehlerpfade instrumentieren soll, die A5 gerade erst sauber gemacht hat. |
| 6 | **A7 (neu) – Reaction-Infrastruktur & Allowlist** | Technische Voraussetzung für B5, C1, C2, D — muss einmal zentral gebaut werden statt viermal parallel. |
| 7 | B5 – Adaptive Akzeptanzschwelle | Erster Reaction-Feature-Verbraucher; einfachster Fall (nur zwei Reactions, ein Bias-Feld). |
| 8 | C1 – Dream-Deal-Score | Nutzt exakt dieselbe Anti-Overreaction/Decay/Audit-Infrastruktur wie B5 — direkt danach, um Code zu teilen statt zu duplizieren. |
| 9 | C2 – Fehltreffer melden & filtern | Nutzt A7 (Reactions/Allowlist) und A4 (neue Similarity-Prüfung gegen Alias-Liste). |
| 10 | D – Auktions-Sniper-Reminder | Nutzt A7, A2 (Persistenz neuer Reminder-Liste), A5 (Scheduler-Robustheit), Schema-Erweiterung um `itemEndDate`. |
| 11 | A6 – Liquipedia-API-Konformität | Unabhängig, aber mit offener Grundsatzfrage (toter Code vs. aktiver VLR-Scraper) — bewusst nach den User-facing-Features, weil die Antwort den Scope stark verändert. |
| 12 | B6 – Semantisches Alias-Fallback | Baut auf dem A4-Testkorpus auf; unabhängig von den Reaction-Punkten. |
| 13 | B2 – Deal-Timing-Orakel | Unabhängiges Feature; nach Observability (A3), damit Fehlerraten der neuen API von Anfang an sichtbar sind. Freigabe der eBay-API muss vorher extern geklärt sein. |
| 14 | B4 – Cross-Marketplace-Arbitrage | Baut fachlich auf B2 (Sold-Comps/Margen-Logik) auf, muss danach kommen. |

---

## A1 – Secrets-Handling

**Ziel:** Discord-Bot-Token und eBay-Client-Secret können aus Docker-Secrets-Dateien statt Klartext-Env gelesen werden; Logs enthalten nie mehr Token-Werte, auch nicht versehentlich in einem `error`-Objekt.

**Betroffene Dateien:**
- `src/app/env/index.ts` (neuer Preprocessing-Schritt vor `envSchema.parse`)
- `src/app/shared/logger.ts` (neue `redact`-Option)
- `Dockerfile` (kein Secret-Bezug nötig, bleibt unverändert)
- Neu: `docker-compose.yml` im Repo-Root (existiert aktuell nicht) für Secrets-Demo/Betrieb
- `.env.example` (Dokumentation der `*_FILE`-Variablen ergänzen)

**Abhängigkeiten:** Keine.

**Abweichungen von den Annahmen:** Fail-fast-Validierung existiert bereits (siehe oben, Punkt 3). Kein Docker-Secrets-Mechanismus existiert (reiner `process.env`-Zugriff).

**Konkrete Umsetzungsschritte:**
1. In `src/app/env/index.ts` vor `const parsed = envSchema.parse(process.env)` eine kleine Funktion `resolveSecretFileOverrides()` einbauen: für eine feste Liste von Var-Namen (`DISCORD_BOT_TOKEN`, `EBAY_CLIENT_SECRET`, `EBAY_APP_ID`) prüfen, ob `${NAME}_FILE` gesetzt ist; wenn ja, synchron lesen (`fs.readFileSync(path, 'utf8').trim()`) und in `process.env[NAME]` schreiben, bevor `envSchema.parse` läuft. Kein neues Package nötig (`fs` genügt).
2. Fehler beim Lesen der Secret-Datei (Datei fehlt, keine Rechte) sollen mit derselben Fail-Fast-Semantik wie `requireValue()` behandelt werden — einfach die Exception durchreichen lassen (nicht abfangen), das bricht den Prozess vor dem Discord-Login ab.
3. `src/app/shared/logger.ts`: `redact: { paths: ['*.token', '*.error.config.headers.Authorization', 'DISCORD_BOT_TOKEN', 'EBAY_CLIENT_SECRET', '*.env.DISCORD_BOT_TOKEN', '*.env.EBAY_CLIENT_SECRET'], censor: '[REDACTED]' }` ergänzen. Genaue Pfade müssen anhand tatsächlicher Log-Aufrufe verifiziert werden (`grep -rn "logger\.\(info\|warn\|error\)" src` durchgehen und prüfen, ob irgendwo ganze `env`- oder Axios-`error`-Objekte geloggt werden, die Header enthalten könnten — `axios`-Fehlerobjekte enthalten `error.config.headers.Authorization` mit dem eBay-Bearer-Token).
4. `docker-compose.yml` minimal ergänzen mit `secrets:`-Sektion (Datei-basiert, funktioniert auch ohne Swarm ab Compose v3.1) und Service, der `DISCORD_BOT_TOKEN_FILE=/run/secrets/discord_bot_token` etc. setzt.
5. `.env.example` um Kommentarzeile ergänzen, dass `_FILE`-Suffix-Varianten unterstützt werden.

**Teststrategie:**
- Neuer `node:test`-Fall in `src/app/env/index.test.ts` (existiert noch nicht): temporäre Datei schreiben, `${NAME}_FILE` setzen, prüfen dass `env.X` den Dateiinhalt trägt statt eines direkt gesetzten `process.env.X`.
- Manueller Rauchtest: Container mit `docker compose up` gegen die neue Compose-Datei starten und prüfen, dass der Bot mit Secrets aus Dateien bootet.
- `pino`-Redact manuell verifizieren: bewusst einen Fehler mit Token im Objekt loggen (Testskript), Ausgabe muss `[REDACTED]` zeigen.

**Risiken/Rollback:** Sehr gering — reine Erweiterung, alte Env-Var-Methode bleibt vollständig funktionsfähig (Fallback wenn `_FILE`-Var fehlt). Rollback = Revert des Commits.

**Offene Fragen an dich:**
- Betreibt ihr das Ding aktuell überhaupt mit Docker Compose oder nur mit rohem `docker run`? Falls nur `docker run`: dann ist die `_FILE`-Konvention trotzdem die richtige Wahl (funktioniert mit `-v secretfile:/run/secrets/x:ro -e DISCORD_BOT_TOKEN_FILE=/run/secrets/x`), aber die neue `docker-compose.yml` wäre dann nur Referenz/optional — sag mir, ob ich sie trotzdem anlegen soll oder ob euch eine reine README-Notiz reicht.
- ANTWORT: Wir betreiben es bisher noch gar nicht, nur testweise starten wir es mit npm start.
- Sollen wirklich beide eBay-Werte (`EBAY_APP_ID` und `EBAY_CLIENT_SECRET`) als Secret behandelt werden, oder nur das Client Secret (App ID ist typischerweise nicht sensibel)?
- ANTWORT: Nur das Client Secret
---

## A2 – Atomic Writes (erweitert, State-Rotation)

**Ziel:** Alle drei persistierten JSON-State-Dateien (`scanner-state.json`, `discord-admin-state.json`, `valorant-compositions.json`) schreiben konsistent über Temp-Datei+Rename, und die letzten N Versionen jeder Datei werden als Backup rotiert, sodass ein Crash mitten im Schreibvorgang nie zu Totalverlust führt.

**Betroffene Dateien:**
- `src/domains/gpu/domain/scannerState.ts` (Backup-Rotation ergänzen, atomarer Write existiert schon)
- `src/integrations/discord/adminState.ts` (`persist()` auf tmp+rename umstellen)
- `src/domains/valorant/storage/fileRepository.ts` (`save()` auf tmp+rename umstellen)
- Neu: ein kleines gemeinsames Utility, z. B. `src/app/shared/atomicFile.ts`, das `writeFileAtomic(path, content)` und `rotateBackups(path, keep)` exportiert — wird von allen drei Stores genutzt, um Duplikation zu vermeiden.

**Abhängigkeiten:** Keine (kann parallel zu A1 laufen).

**Abweichungen von den Annahmen:** Siehe Abweichung 1 oben — GPU-Scanner-State ist bereits atomar (nur Rotation fehlt); die anderen zwei Stores sind es nicht.

**Konkrete Umsetzungsschritte:**
1. `src/app/shared/atomicFile.ts` neu anlegen:
   ```ts
   export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
     const tmpPath = `${filePath}.tmp`;
     await fs.mkdir(path.dirname(filePath), { recursive: true });
     await fs.writeFile(tmpPath, content);
     await fs.rename(tmpPath, filePath);
   }

   export async function rotateBackups(filePath: string, keep: number): Promise<void> {
     // ponytail: einfache Kopie vor dem Write, keine Versionierungs-Bibliothek nötig
     ...
   }
   ```
   `rotateBackups` wird **vor** dem eigentlichen Schreiben aufgerufen (kopiert die aktuell noch gültige Datei nach `${filePath}.bak.1`, schiebt bestehende `.bak.1..N-1` eins weiter, löscht `.bak.N` falls vorhanden) — einfache Ringpuffer-Logik mit `fs.copyFile`/`fs.rename`, keine neue Library.
2. `scannerState.ts:persist()` umbauen, um `writeFileAtomic` aus dem neuen Utility zu nutzen (Verhalten bleibt identisch) und **vor** dem Schreiben `rotateBackups(statePath, env.SCANNER_STATE_BACKUP_COUNT)` aufzurufen.
3. `adminState.ts:persist()` von direktem `fs.writeFile` auf `writeFileAtomic` + `rotateBackups` umstellen.
4. `fileRepository.ts:save()` genauso umstellen.
5. Neue Env-Var `SCANNER_STATE_BACKUP_COUNT` (Default z. B. `3`) in `envSchema` ergänzen — ein Wert für alle drei Stores, kein Grund für drei separate Konfigurationen bei einer Zwei-Personen-Nutzergruppe.
6. Backup-Dateien (`*.bak.*`) zur `.dockerignore`/`.gitignore` hinzufügen, falls `data/` überhaupt versioniert wird (prüfen: aktuell ist `data/` nicht in `.gitignore` gelistet — offene Frage unten).

**Teststrategie:**
- Neuer Test `src/app/shared/atomicFile.test.ts`: schreibt mehrfach hintereinander, prüft dass nach jedem Write genau `keep` Backup-Dateien existieren und der Inhalt von `.bak.1` dem vorherigen Hauptinhalt entspricht.
- Bestehende `scannerState.test.ts`, `adminUtils.test.ts` (falls dort State-Writes getestet werden) müssen weiterhin grün sein — keine Verhaltensänderung am Hauptpfad, nur zusätzliche Rotation.
- Crash-Simulation (manuell, nicht automatisiert): Prozess während eines Schreibvorgangs mit `kill -9` beenden (z. B. künstlich verzögerter Write in einem Testskript) und prüfen, dass die Hauptdatei entweder komplett alt oder komplett neu ist, nie halb geschrieben.

**Risiken/Rollback:** Gering. Rotation fügt zusätzliche Dateisystem-Operationen hinzu (vernachlässigbar bei dieser Datenmenge). Rollback = Revert, alte Dateien bleiben kompatibel (Schema der Hauptdatei ändert sich nicht, nur zusätzliche `.bak.*`-Dateien kommen hinzu).

**Offene Fragen an dich:**
- Ist `data/` aktuell überhaupt im Git-Repo versioniert oder nur als Docker-Volume gemountet? Falls versioniert: sollen `.bak.*`-Dateien ins `.gitignore`, damit sie nicht versehentlich committet werden?
- ANTWORT: Data wird nicht versioniert
- Reicht ein gemeinsamer `SCANNER_STATE_BACKUP_COUNT`-Wert für alle drei Stores, oder soll jeder Store einen eigenen Wert bekommen (mehr Konfigurationsaufwand für vermutlich keinen echten Zusatznutzen bei dieser Nutzergruppengröße)?
- ANTWORT: ein gemeinsamer Wert reicht
---

## A5 – Fehler-Isolation zwischen den Domains

**Ziel:** Ein Fehler im Valorant-Sync (wiederkehrender Tick) oder im initialen GPU-Start darf weder den Prozess crashen noch die jeweils andere Domain lahmlegen. Jeder Scheduler-Tick jeder Domain hat ein eigenes Error-Boundary mit Logging.

**Betroffene Dateien:**
- `src/domains/valorant/scheduler/syncScheduler.ts` (try/catch um `runAndReschedule`)
- `src/app/bootstrap.ts` (try/catch um `gpuModule.start()`, symmetrisch zum bestehenden Valorant-Try/Catch)
- Optional: `process.on('unhandledRejection', ...)`-Handler als letztes Sicherheitsnetz (aktuell nirgends registriert, verifiziert)

**Abhängigkeiten:** Keine.

**Abweichungen von den Annahmen:** Der Auftrag ging davon aus, dass Fehler-Isolation komplett fehlt. Tatsächlich hat der GPU-Scheduler sie schon (`scanScheduler.ts` try/catch/finally pro Tick, siehe Recherche). Der reale Scope ist kleiner und präziser: nur der Valorant-Scheduler und der `bootstrap.ts`-Start-Pfad.

**Konkrete Umsetzungsschritte:**
1. In `syncScheduler.ts`, Methode `runAndReschedule(trigger)`: den Aufruf von `this.syncService.runSync(trigger)` in try/catch einpacken, im catch-Block `logger.error({ error, trigger }, 'valorant sync tick failed')` loggen (Logger-Import ergänzen — aktuell fehlt er in dieser Datei, siehe Recherche). Das `finally`, das `scheduleNextRun()` aufruft, bleibt wie es ist (das ist bereits korrekt so aufgebaut, nur der Fehler wurde bisher nicht abgefangen).
2. In `bootstrap.ts`: `await gpuModule.start();` (Zeile 41) in ein eigenes try/catch einpacken, analog zum bestehenden Valorant-Block (Zeilen 27-31), mit `logger.error({ error }, 'gpu module failed to start; ...')`. Wichtig: **nicht** den Prozess dabei beenden, sondern nur loggen — der Prozess soll weiterlaufen, damit z. B. Valorant trotzdem verfügbar bleibt (Discord-Client ist ja schon gestartet, `notifier.start()` lief vorher).
3. Prüfen (Lesen, nicht raten), ob `gpuModule.start()` etwas zurückgibt, das andere Teile brauchen — laut `module.ts` ist es `Promise<void>`, also unkritisch.
4. `process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'))` in `bootstrap.ts` ganz oben ergänzen als letztes Netz — bewusst **kein** `process.exit()` darin, sonst hebelt es genau die gewünschte Isolation wieder aus.

**Teststrategie:**
- Neuer Test `syncScheduler.test.ts` (existiert noch nicht, siehe Abweichung: Recherche fand kein Test-File dafür): Mock-`syncService.runSync` wirft einmal, Scheduler muss trotzdem `scheduleNextRun()` aufrufen (verifizierbar über gemockten `setTimeout`/Fake-Timer) und darf keine unhandled rejection erzeugen (Test schlägt sonst über Node's `process.on('unhandledRejection')` in der Testumgebung fehl).
- Bestehender `scanScheduler.test.ts` bleibt unverändert grün (kein Verhaltenswechsel dort).
- Manueller Test: `EBAY_PROVIDER=invalid` (erzwingt Fehler in GPU-Start) setzen, prüfen dass Valorant trotzdem hochfährt und der Prozess nicht beendet wird (aktuell würde das den ganzen Prozess killen).

**Risiken/Rollback:** Sehr gering, reine Ergänzung von Error-Handling ohne Verhaltensänderung im Erfolgsfall. Rollback = Revert.

**Offene Fragen an dich:**
- Soll ein dauerhaft fehlschlagender Valorant-Sync (z. B. 10x in Folge) irgendwann eine Discord-Warnung auslösen, oder reicht stilles Logging, bis jemand manuell reinschaut? (Aktuell gibt es `healthState`/`healthReasons` im Valorant-State — das könnte man wiederverwenden, aber das wäre über den hier beschriebenen Scope hinaus.)
- ANTWORT: Stilles Logging reicht
---

## A4 – Property-based Tests

**Ziel:** `profileMatcher`, `aliasMatcher`, `filterEngine`, `repairabilityScore` werden gegen zufällig generierte Eingaben (Property-based) sowie einen festen Regressionskorpus aus echten, anonymisierten Listing-Titeln getestet, um Edge Cases (Umlaute, gemischte Sprachen, fehlende Felder, HTML-Entities) abzudecken, die die bestehenden Beispiel-basierten Tests nicht abdecken.

**Betroffene Dateien:**
- `package.json` (neue Dev-Dependency `fast-check`)
- `src/domains/gpu/domain/profileMatcher.test.ts`, `aliasMatcher.test.ts` (neu, existiert noch nicht laut Recherche — nur `filterEngine.test.ts`, `profileMatcher.test.ts` (bereits vorhanden laut Dateiliste — korrigiert: es existiert `profileMatcher.test.ts` bereits, `aliasMatcher.test.ts` existiert **nicht** separat), `filterEngine.test.ts`, `repairabilityScore.test.ts` (alle bereits vorhanden — property-based Fälle werden ergänzt, keine neuen Dateien nötig außer für `aliasMatcher`)
- Neu: `src/domains/gpu/domain/aliasMatcher.test.ts`
- Neu: `src/domains/gpu/domain/__fixtures__/regressionListings.json` (anonymisierter Korpus)

**Abhängigkeiten:** Keine harte Abhängigkeit, aber sinnvollerweise vor C2 (die neue Similarity-Prüfung braucht ein verlässliches Test-Netz um `aliasMatcher`).

**Abweichungen von den Annahmen:** `fast-check` ist nicht installiert (neue Dependency). `aliasMatcher.ts` hat noch keine eigene Testdatei — die Matching-Logik wird bisher indirekt über `profileMatcher.test.ts` mitgetestet.

**Konkrete Umsetzungsschritte:**
1. `npm install --save-dev fast-check` (funktioniert mit `node:test`, keine Bindung an vitest/jest nötig — `fc.assert(fc.property(...))` lässt sich direkt in eine `test()`-Funktion aus `node:test` einbetten).
2. Für jede der vier Dateien 3-5 gezielte Properties definieren, keine pauschale "fuzz everything"-Strategie (ponytail: Properties nur dort, wo eine echte Invariante existierbar ist, kein Kunstprodukt):
   - `profileMatcher`: „Für jedes Profil, dessen Alias exakt im (normalisierten) Titel vorkommt und dessen `negativeAliases` nicht vorkommen, liefert `selectProfileForListing` nie `null`."
   - `aliasMatcher`: „`listingMatchesAlias` ist tolerant gegenüber zusätzlichem Whitespace/Case — für jeden String `s` und Alias `a`, wenn `s.includes(a)` nach Normalisierung gilt, matched auch eine zufällig case-permutierte/whitespace-verrauschte Variante von `s`."
   - `filterEngine`: „`evaluateListing` wirft nie eine Exception, egal welche (auch unvollständigen) `EbayListing`-Objekte reinkommen" (robuste Fuzzing-Property gegen fehlende Felder).
   - `repairabilityScore`: „`assessRepairability(...).score` liegt für jede beliebige Kombination von Signal-Texten immer im Bereich `[0, 100]`."
3. Regressionskorpus: eine JSON-Datei mit ca. 20-40 anonymisierten, echten Problemtiteln (Nutzer muss diese liefern oder freigeben, siehe offene Frage) — Testfall iteriert über den Korpus und prüft nur strukturelle Eigenschaften (kein Crash, Health nie `undefined`), nicht exakte erwartete Werte, da echte Titel sich ändern können.
4. HTML-Entity- und Umlaut-Fälle gezielt als feste (nicht zufällige) Testfälle ergänzen, z. B. `"RTX 3070 &amp; Zubehör, defekt"`.

**Teststrategie:** Ist selbst die Teststrategie für andere Punkte — Erfolgskriterium hier: `npm test` bleibt grün, neue Property-Tests laufen mit fester Seed-Anzahl (`fc.assert(..., { numRuns: 100 })`, ponytail: kein exzessiver `numRuns`, 100 reicht für einen Zwei-Personen-Bot).

**Risiken/Rollback:** Minimal — reine Testergänzung, keine Produktionscode-Änderung außer ggf. Bugfixes, die die Property-Tests aufdecken (die werden dann einzeln bewertet, nicht blind gefixt).

**Offene Fragen an dich:**
- Kannst du mir eine Handvoll echter, bereits anonymisierter Problem-Listing-Titel geben (die Fälle, die früher falsch gematcht haben), oder soll ich synthetische Beispiele bauen, die die genannten Kategorien (Umlaute, gemischte Sprachen, fehlende Felder, HTML-Entities) abdecken, ohne echte Daten zu verwenden?
- ANTWORT: Die Beispiele kannst du dir selber mithilfe eines kleinen Zusatzskriptes holen, in dem du eine spezielle Ebay-Anfrage machst und einfach mal schaust, was so problembehaftetes rauskommt
---

## A3 – Observability (OpenTelemetry)

**Ziel:** Jeder Poll-Zyklus (GPU-Scan, Valorant-Sync) erzeugt einen Trace-Span; Counter für eBay-Rate-Limit-Hits, eBay-API-Fehler und Discord-Retries werden erfasst und an einen konfigurierbaren Endpunkt exportiert (Prometheus-Pull oder OTLP-Push, konfigurierbar). Ergänzt `pino`, ersetzt es nicht.

**Betroffene Dateien:**
- `package.json` (neue Dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus` oder `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`)
- Neu: `src/app/shared/telemetry.ts` (SDK-Init, Tracer/Meter-Export)
- `src/app/bootstrap.ts` (Telemetry-Init ganz am Anfang, vor allen anderen Imports mit Seiteneffekten)
- `src/domains/gpu/application/scanScheduler.ts` (Span um `runScheduledScan`)
- `src/domains/valorant/scheduler/syncScheduler.ts` (Span um `runAndReschedule`, siehe A5 — beide Änderungen sollten im selben Bereich passieren, aber A5 zuerst, damit die Fehlerbehandlung schon steht, bevor Tracing drumherum gebaut wird)
- `src/domains/gpu/infrastructure/ebay/http.ts` (Counter für 429/5xx/Retry in `withRetry()`)
- `src/integrations/discord/notifier.ts` (Counter für Discord-Retries, z. B. in der Rate-Limit-Wartelogik `waitForSendWindow`)
- `src/app/env/index.ts` (neue Env-Vars: `OTEL_EXPORTER_ENDPOINT`, `OTEL_ENABLED`)

**Abhängigkeiten:** A5 (Fehler-Isolation) sollte zuerst stehen, damit die Span-Fehlerstatus-Zuordnung (`span.recordException`) an bereits korrekt gefangenen Fehlern hängt statt an unhandled rejections.

**Abweichungen von den Annahmen:** Komplette Neuintegration, keine bestehende OTel-Nutzung.

**Konkrete Umsetzungsschritte:**
1. `@opentelemetry/sdk-node` + Prometheus-Exporter installieren (Prometheus-Exporter ist die pragmatischste Wahl für einen Zwei-Personen-Bot: startet einfach einen lokalen HTTP-Endpunkt `/metrics`, kein externer Collector-Service nötig — ponytail: kein OTLP-Collector-Deployment für zwei Nutzer aufsetzen, wenn ein simpler Scrape-Endpunkt reicht).
2. `src/app/shared/telemetry.ts`: `NodeSDK` mit `PrometheusExporter({ port: env.OTEL_PROMETHEUS_PORT })` initialisieren, nur wenn `env.OTEL_ENABLED` true ist (Default `false`, damit lokale Entwicklung/Tests nicht plötzlich einen Metrics-Port aufmachen).
3. In `bootstrap.ts` ganz oben `import './shared/telemetry.js';` (mit Seiteneffekt: SDK-Start) **vor** allen Domain-Imports, wie es OpenTelemetry für Node vorschreibt (Instrumentierungs-Hooks müssen vor dem zu instrumentierenden Modul geladen werden — hier aber ohnehin nur manuelle Spans, kein Auto-Instrumentation-Agent, daher weniger kritisch, aber sauberer Stil).
4. Manuelle Spans (kein Auto-Instrumentation-Package nötig, da wir nur zwei Scheduler-Ticks + eine Handvoll HTTP-Aufrufe erfassen wollen — ein Tracer reicht, kein `@opentelemetry/instrumentation-http`):
   ```ts
   const tracer = trace.getTracer('gpu-search');
   await tracer.startActiveSpan('gpu.scan.tick', async span => {
     try { /* runScan */ } catch (e) { span.recordException(e); throw e; } finally { span.end(); }
   });
   ```
5. Counter-Metriken über `meter.createCounter('ebay.http.retries')`, `meter.createCounter('ebay.http.rate_limit_hits')`, `meter.createCounter('discord.send.retries')` — jeweils an der Stelle inkrementieren, wo `withRetry()` bzw. die Discord-Rate-Limit-Logik heute schon (ungezählt) reagiert.
6. Dokumentation in README ergänzen: wie man den Prometheus-Endpunkt lokal scraped (`curl localhost:9464/metrics`).

**Teststrategie:**
- Unit-Test für `telemetry.ts`: SDK startet nicht, wenn `OTEL_ENABLED=false` (Default) — kein offener Port in normalen Testläufen.
- Manueller Test: `OTEL_ENABLED=true npm start`, dann `curl localhost:9464/metrics` und prüfen, dass nach einem manuellen Scan-Trigger (`/scan`-Command falls vorhanden, oder Force-Rescan) die Counter hochzählen.
- Kein automatisierter Trace-Content-Test nötig (das würde einen echten Collector brauchen) — reicht, dass Spans ohne Exception erzeugt werden.

**Risiken/Rollback:** Mittel — neue Runtime-Dependency, die bei Fehlkonfiguration (falscher Port, Port-Konflikt) den Start blockieren könnte. Mitigation: Telemetry-Init selbst in try/catch, Fehler dort nur loggen, nie den Bot-Start verhindern. Rollback = `OTEL_ENABLED=false` setzen oder Commit reverten.

**Offene Fragen an dich:**
- Prometheus-Pull (lokaler `/metrics`-Endpunkt, du scrapest selbst) oder OTLP-Push zu einem bestehenden Collector/Grafana Cloud/etc.? Das ändert, welchen Exporter ich installiere. Ich empfehle Prometheus-Pull als Default, weil ihr aktuell offenbar keine Observability-Infrastruktur habt (kein `docker-compose.yml`, keine Hinweise auf einen Collector).
- ANTWORT: Prometheus Pull
- Auf welchem Host/Port soll der Metrics-Endpunkt lauschen, und muss der von außerhalb des Docker-Containers erreichbar sein (Port-Mapping nötig)?
- ANTWORT: Keine Ahnung, entscheid du, wir sind noch nicht so weit dass wir es irgendwo hosten
---

## A7 (neu, nicht im Original-Auftrag) – Reaction-Infrastruktur & Allowlist

**Ziel:** Es existiert eine wiederverwendbare, zentrale Möglichkeit, auf Discord-Reactions zu reagieren, strikt beschränkt auf eine konfigurierbare Allowlist von User-IDs (`ALLOWED_REACTOR_IDS`), auf der B5, C1, C2 und D aufbauen — ohne dass jedes Feature seinen eigenen Reaction-Listener und seine eigene Allowlist-Prüfung neu schreibt.

**Betroffene Dateien:**
- `src/integrations/discord/notifier.ts` (Intent `GatewayIntentBits.GuildMessageReactions` ergänzen, neuer `Events.MessageReactionAdd`-Listener, neue Dispatch-Struktur für „welches Feature gehört zu welcher Message/Reaction")
- `src/app/env/index.ts` (neue Env-Var `ALLOWED_REACTOR_IDS`, komma-separierte Liste)
- Neu: `src/integrations/discord/reactionRouter.ts` — zentrale Zuordnung Message-ID → Feature-Typ → Handler (ersetzt eine reine Emoji-Prüfung, siehe unten)
- `src/domains/gpu/domain/scannerState.ts` (falls die Message-ID→Typ-Zuordnung dort mitgespeichert werden soll, siehe Abgrenzungsfrage in B5)

**Abhängigkeiten:** Keine (kann parallel zu A3 laufen, ist aber inhaltlich näher an B5/C1/C2/D, deshalb direkt davor in der Reihenfolge).

**Abweichungen von den Annahmen:** Dieser Punkt stand nicht explizit in der Liste, ist aber zwingend nötig, weil weder Reaction-Handling noch ein env-basiertes Allowlist-Konzept aktuell existieren (siehe Abweichungen 5 und 6 oben). Discord-Reactions auf Bot-Nachrichten von unbekannten dritten Usern (z. B. jemand reagiert versehentlich in einem Server, in dem der Bot auch läuft) müssen still ignoriert werden — das ist die Kernanforderung „nur Allowlist-User" aus dem Auftrag.

**Konkrete Umsetzungsschritte:**
1. `envSchema` um `ALLOWED_REACTOR_IDS: z.string().default('')` ergänzen, geparst zu `Set<string>` via `.split(',').map(s => s.trim()).filter(Boolean)` (analog zu `ALLOW_COUNTRIES`, das denselben Pattern schon nutzt — kein neues Parsing-Konzept nötig).
2. In `notifier.ts`: `GatewayIntentBits.GuildMessageReactions` zum `intents`-Array ergänzen. **Wichtig:** Reactions auf alte Nachrichten (vor Bot-Neustart) werden von discord.js standardmäßig als „partial" geliefert — `partials: [Partials.Message, Partials.Reaction]` im `Client`-Konstruktor ergänzen, sonst schlägt das Event für ältere/uncached Nachrichten fehl.
3. Neuer Listener `this.client.on(Events.MessageReactionAdd, async (reaction, user) => { ... })`:
   - Zuerst `if (user.bot) return;` (eigene Reactions ignorieren).
   - Dann `if (!env.ALLOWED_REACTOR_IDS.has(user.id)) return;` — **stillschweigend**, keine Fehlermeldung an den User (Anforderung aus dem Auftrag: "Reaktionen anderer Nutzer werden stillschweigend ignoriert").
   - Danach Dispatch an `reactionRouter.handle(reaction, user)`.
4. `src/integrations/discord/reactionRouter.ts`: Kernstück ist eine Zuordnung `messageId → { type: 'acceptance-feedback' | 'dream-deal-feedback' | 'exclusion-report' | 'auction-reminder', profileName?, listingId? }`. Diese Zuordnung **muss persistiert** werden (Prozess-Neustart-sicher) — sie lebt sinnvollerweise direkt in `scanner-state.json` als neues optionales Feld pro `SeenRecord` (z. B. `reactionRoles?: { emoji: string; type: string }[]`) statt in einer separaten Datei, weil die Message-ID ohnehin schon Teil von `SeenRecord` ist (`notificationMessageId`). Das erfüllt direkt die Abgrenzungsanforderung aus B5 ("Message-ID → Typ-Zuordnung im State, nicht nur über das Emoji").
5. `reactionRouter` exportiert eine Registrierungs-API, z. B. `registerHandler(type: string, handler: (ctx) => Promise<void>)`, die B5/C1/C2/D jeweils in ihrem eigenen Modul aufrufen — der Router selbst kennt keine Feature-Details (ponytail: Router bleibt dumm, Fachlogik bleibt in den Feature-Modulen).
6. Bot postet bei allen vier Feature-Alerts die jeweiligen Reactions direkt nach dem Senden (`message.react('👍')` etc., discord.js-Standard-API, kein neues Package).

**Teststrategie:**
- Neuer Test `reactionRouter.test.ts`: simuliert einen `MessageReactionAdd`-Event-Payload für einen erlaubten und einen nicht erlaubten User, prüft dass nur der erlaubte Handler auslöst.
- Manueller Discord-Test: mit einem Zweit-Account (nicht in `ALLOWED_REACTOR_IDS`) auf eine Alert-Nachricht reagieren → keine Reaktion vom Bot. Mit erlaubtem Account reagieren → registrierter Test-Handler wird aufgerufen (Dummy-Handler für den manuellen Test).

**Risiken/Rollback:** Mittel — neuer Intent erfordert ggf. erneute Freigabe im Discord Developer Portal (Message Content Intent ist schon aktiv, Reaction-Intent ist unprivilegiert und braucht keine gesonderte Freischaltung, nur Code-seitig aktivieren). Rollback = Feature-Flag `REACTIONS_ENABLED` (Default `false`) vorsehen, damit im Zweifel ohne Codeänderung abschaltbar.

**Offene Fragen an dich:**
- Sollen `ALLOWED_REACTOR_IDS` dieselben User-IDs sein wie `DISCORD_ADMIN_USER_IDS`, oder eine bewusst andere/größere Gruppe (z. B. auch die "paar Freunde" aus der Rahmenbedingung, die keine Admin-Rechte haben sollen)?
- ANTWORT:  ja dieselben
- Soll ich `DISCORD_ADMIN_USER_IDS` im selben Zug von hartcodiert auf env-basiert umstellen (`ALLOWED_ADMIN_IDS`), um Konsistenz zu schaffen? Das stand nicht explizit im Auftrag, wäre aber ein nahezu kostenloser Nebeneffekt, wenn wir schon ein Env-Allowlist-Konzept bauen.
- ANTWORT: ja
---

## B5 – Adaptive Akzeptanzschwelle per Reaction-Feedback

**Ziel:** Jede normale Deal-Alert-Nachricht bekommt 👍/👎-Reactions; wiederholtes, gleichgerichtetes Feedback (3 von 5 im rollierenden Fenster) verschiebt einen begrenzten Laufzeit-Bias auf das konfigurierte Preislimit je Profil, der im nächsten Poll-Zyklus tatsächlich wirkt, mit Decay über Zeit und einer Info-Nachricht samt ↩️-Reset-Reaction bei jeder Anpassung.

**Betroffene Dateien:**
- `src/domains/gpu/domain/scannerState.ts` (neues Feld `acceptanceBias` pro Profil im State — nicht in `gpu-profiles.json`)
- `src/domains/gpu/domain/filterEngine.ts` (Anwendung von `effectiveLimit = configuredLimit * (1 + acceptanceBias)` in `baseLimitForOfferType()`/`acceptedForOfferType()`)
- `src/integrations/discord/reactionRouter.ts` (Handler für `type: 'acceptance-feedback'`, aus A7)
- `src/integrations/discord/notifier.ts` (Info-Nachricht bei Bias-Änderung, ↩️-Reset-Reaction)
- `src/domains/gpu/application/scanner.ts` oder `scanScheduler.ts` (Bias muss beim nächsten Tick aus dem State gelesen und in `evaluateListing()` durchgereicht werden — aktuell nimmt `evaluateListing` nur `profile` entgegen, das müsste um einen `biasOverride`-Parameter erweitert werden, oder der Bias wird vor dem Aufruf in eine Kopie des Profils gerechnet)

**Abhängigkeiten:** A7 (Reaction-Infrastruktur), A2 (atomare Writes für das neue State-Feld), A5 (Scheduler-Robustheit, da der Bias bei jedem Tick gelesen wird und ein Fehler hier nicht den ganzen Scan crashen darf).

**Abweichungen von den Annahmen:** Keine wesentlichen — der Mechanismus wie im Auftrag beschrieben ist mit der bestehenden Architektur gut vereinbar. Einzige Präzisierung: `gpu-profiles.json` hat keine generische "Score-Schwelle", sondern vier Preis-Felder (`buyNowWorking/buyNowDefect/auctionWorking/auctionDefect`) — der Bias muss auf **alle vier** angewendet werden oder auf eine gezielt auswählbare Untermenge (siehe offene Frage).

**Konkrete Umsetzungsschritte:**
1. `ScannerStateFile`-Schema (`scannerState.ts`) um ein neues Top-Level-Feld erweitern, z. B.:
   ```ts
   interface ProfileBiasRecord {
     profileName: string;
     acceptanceBias: number; // bounded [-0.15, 0.15]
     recentReactions: { direction: 'up' | 'down'; at: string }[]; // rollierendes Fenster, z. B. letzte 5
     lastAdjustedAt?: string;
   }
   ```
   Version-Bump auf `4` mit Migrationslogik in `loadInternal()` (fehlt das Feld beim Laden alter Dateien → leeres Array, Bias `0` — Default-Migration, kein Schema-Break).
2. Neue Funktion `recordAcceptanceReaction(profileName, direction)` in `scannerState.ts`: fügt Reaction zum rollierenden Fenster hinzu (max. letzte 5, älter droppen), prüft ob 3 von 5 gleichgerichtet sind, wendet dann einen Schritt an (z. B. `±0.05`, geclampt auf `[-0.15, 0.15]`), reset das Fenster nach angewendeter Änderung (verhindert sofortiges erneutes Auslösen durch dieselben 3 Reactions).
3. Decay: bei jedem Scan-Tick (in `scanScheduler.ts`, vor dem eigentlichen Scan) einen Decay-Schritt anwenden, z. B. `acceptanceBias *= 0.98` pro Tag seit `lastAdjustedAt` (einfache exponentielle Annäherung an 0, kein Kalenderlogik-Overhead nötig — ponytail: ein Multiplikator reicht, kein Decay-Framework).
4. `filterEngine.ts`: `evaluateListing()` um optionalen Parameter `effectiveLimitMultiplier` (Default `1`) erweitern, der in `baseLimitForOfferType()` multipliziert wird. Der Aufrufer (`scanner.ts`) liest vor jedem Profil-Vergleich `stateStore.getAcceptanceBias(profile.name)` und übergibt `1 + bias`.
5. `reactionRouter`: Handler für `acceptance-feedback` registrieren, der 👍/👎 auf `recordAcceptanceReaction()` mapped, dann bei tatsächlicher Bias-Änderung `notifier.send()` (oder eine neue, einfachere Notifier-Methode `sendBiasAdjustment()`) mit der Info-Nachricht aufruft und die neue Nachricht mit ↩️ reagiert.
6. ↩️-Handler: setzt `acceptanceBias` und das rollierende Fenster für das betroffene Profil zurück auf `0`/leer, postet Bestätigung.
7. Alert-Nachrichten (`messageFormatter.ts`/`notifier.ts`) um automatisches `message.react('👍')` + `message.react('👎')` nach dem Senden ergänzen, und die Message-ID mit `type: 'acceptance-feedback', profileName` im State verknüpfen (siehe A7 Schritt 4).

**Teststrategie:**
- `scannerState.test.ts`: neue Fälle für `recordAcceptanceReaction` — 2 von 5 gleichgerichtet ändert nichts; 3 von 5 ändert genau einen Schritt; Bias bleibt innerhalb `[-0.15, 0.15]` auch bei wiederholtem Feedback in dieselbe Richtung; Decay reduziert Bias über simulierte Zeit.
- `filterEngine.test.ts`: neuer Fall, dass ein Listing mit Preis knapp über dem Basislimit akzeptiert wird, wenn `acceptanceBias > 0` übergeben wird, und abgelehnt bei `acceptanceBias < 0`.
- Manueller Discord-Test: künstlich 3x 👎 auf simulierte Alerts für ein Test-Profil, prüfen dass Info-Nachricht mit korrektem alten/neuen Preis erscheint und der nächste Scan das neue Limit nutzt (per Debug-Scan-Command verifizierbar, falls vorhanden — `onDebugScanRequested` existiert laut `botBindings.ts`).

**Risiken/Rollback:** Mittel — Bias könnte bei Bedienfehlern (versehentliches Massen-👎) das Profil de-facto stilllegen. Mitigation: harte Bounds (`±15%`) wie im Auftrag gefordert, plus der Decay-Mechanismus als automatisches Recovery. Rollback: neues State-Feld ignorieren (Bias auf `0` erzwingen) über einen Feature-Flag `ADAPTIVE_THRESHOLD_ENABLED=false`.

**Offene Fragen an dich:**
- Der Bias soll laut Auftrag auf "den konfigurierten Preis-/Score-Grenzwert" wirken — es gibt aber vier separate Preisfelder pro Profil (`buyNowWorking/buyNowDefect/auctionWorking/auctionDefect`). Soll der Bias auf alle vier gleich wirken, oder z. B. nur auf die zum jeweiligen Alert passende Kombination aus Angebotstyp+Health (dann müsste das Feedback wissen, auf welchen der vier Werte es sich bezog — technisch möglich, da `SeenRecord` bereits `profileName` trägt, aber nicht `offerType`/`health` des ursprünglichen Alerts; das müsste ergänzt werden)?
- ANTWORT: Entscheide du, was am schlausten ist
- Info-Nachricht bei Bias-Änderung: soll die als neue eigene Nachricht im selben Channel gepostet werden (mein Vorschlag) oder als Edit/Reply auf die letzte betroffene Alert-Nachricht?
- ANTWORT: Ja als Edit/Reply
---

## C1 – Dream-Deal-Score mit eigener Reaction-Recalibrierung

**Ziel:** Eine zweite, deutlich höhere Score-Schwelle löst eine optisch abgesetzte Sondernachricht mit 🔥/🧊-Reactions aus; die Schwelle wird analog zu B5 (bounded, Anti-Overreaction-Fenster, Decay, Audit-Log) über ein separates State-Feld `dreamDealScoreBias` je Profil angepasst.

**Betroffene Dateien:**
- `src/domains/gpu/domain/filterEngine.ts` oder neue Datei `src/domains/gpu/domain/dreamDealScore.ts` (Berechnung des Dream-Deal-Scores aus vorhandenen Signalen)
- `src/domains/gpu/domain/scannerState.ts` (neues, von `acceptanceBias` getrenntes Feld `dreamDealScoreBias` je Profil, plus Audit-Log-Einträge)
- `src/domains/gpu/domain/messageFormatter.ts` (neues, optisch abgesetztes Nachrichtenformat)
- `src/integrations/discord/reactionRouter.ts` (Handler für `type: 'dream-deal-feedback'`)
- `src/integrations/discord/notifier.ts` (Sondernachricht senden, Farbe/Ping abweichend von normalem Alert)

**Abhängigkeiten:** A7, B5 (Code-Wiederverwendung: Anti-Overreaction-Fenster- und Decay-Logik aus B5 sollte als generische Funktion extrahiert werden, z. B. `applyBoundedFeedback(currentBias, window, direction, bounds)` in `scannerState.ts`, die beide Features nutzen, statt Logik zu duplizieren).

**Abweichungen von den Annahmen:** `repairabilityScore.ts` hat aktuell keine Seller-Qualitäts-Signale (nur Text-Pattern-Score) und keinen Preis-vs-Durchschnitt-Delta-Faktor eingebaut (siehe Recherche A4). Das heißt: die "vorhandenen Signale" für den Dream-Deal-Score müssen aus **drei unterschiedlichen Stellen** zusammengeführt werden: `repairabilityScore.score` (nur wenn `health === 'DEFECT'`, sonst nicht berechnet), `limitHeadroomPercent` aus `filterEngine.ts` (Preis-Delta zum *statischen* Profillimit, nicht zu einem Marktdurchschnitt — ein echter Marktdurchschnitt existiert nur in `ProfileMarketStats`/`MarketDashboardSnapshot`, separat berechnet), und `sellerFeedbackPercent`/`sellerFeedbackScore` direkt vom Listing (aktuell nur als Hard-Filter genutzt, nicht als graduelles Signal in einem Score).

**Konkrete Umsetzungsschritte:**
1. Neue Datei `src/domains/gpu/domain/dreamDealScore.ts`, Funktion `calculateDreamDealScore(evaluated: EvaluatedListing, marketStats?: ProfileMarketStats): number`, die eine gewichtete Kombination bildet:
   - `limitHeadroomPercent` (bereits vorhanden, größer = besser) — Hauptgewicht.
   - `repairability?.score` (falls `health === 'DEFECT'`, sonst neutraler Wert, z. B. 100, da WORKING-Listings kein Reparaturrisiko haben).
   - `sellerFeedbackPercent` (linear reingewichtet, fehlend → neutral).
   - Exakte Gewichtungsformel muss mit dir abgestimmt werden (siehe offene Frage) — ich schlage einen einfachen gewichteten Durchschnitt vor (kein ML-Modell, keine Kalibrierung nötig für zwei Nutzer).
2. `dreamDealScoreBias` analog zu `acceptanceBias` im State (eigene Feldgruppe, eigenes rollierendes Fenster, eigener Audit-Log — Audit-Log ist hier explizit gefordert, bei B5 nicht, also als eigenes Array `dreamDealAuditLog: { at, oldThreshold, newThreshold, reason }[]` modellieren).
3. In `scanner.ts`, nach `evaluateListing()`: wenn `accepted && calculateDreamDealScore(...) >= dreamDealThreshold`, zusätzlich `notifier.sendDreamDealAlert(...)` aufrufen (neue optionale Notifier-Methode, analog zu `sendMarketDigest`).
4. `messageFormatter.ts`: neue Funktion `formatDreamDealMessage()`, deutlich abweichende Farbe/Emoji/Titel ("🌟 DREAM DEAL 🌟"), plus 🔥/🧊 statt 👍/👎.
5. Extraktion der generischen Bias-Update-Logik aus B5 in eine gemeinsame Funktion (siehe Abhängigkeiten), damit C1 sie mit anderen Parametern (Bounds, Schrittgröße, Audit-Log ja/nein) wiederverwenden kann.

**Teststrategie:**
- Neue Testdatei `dreamDealScore.test.ts`: Score-Berechnung für synthetische Kombinationen aus Repairability/Headroom/Sellerfeedback, prüft Monotonie (höhere Werte in jeder Einzelkomponente → höherer oder gleicher Score, nie niedriger).
- `scannerState.test.ts`: Audit-Log wird bei jeder tatsächlichen Anpassung um genau einen Eintrag ergänzt, mit korrektem alten/neuen Wert.
- Manueller Test wie bei B5, aber mit 🔥/🧊 auf eine simulierte Dream-Deal-Nachricht.

**Risiken/Rollback:** Mittel — die genaue Gewichtung ist eine Geschmacksfrage, die sich vermutlich erst nach echter Nutzung einpendelt; das ist aber genau der Zweck der Reaction-Recalibrierung. Rollback: Feature-Flag `DREAM_DEAL_ENABLED=false`.

**Offene Fragen an dich:**
- Exakte Ausgangsgewichtung der drei Signale (Preis-Headroom, Repairability, Seller-Feedback) — hast du eine Präferenz, oder soll ich mit einem einfachen gleichgewichteten Start (je 1/3) beginnen und das der Reaction-Recalibrierung überlassen?
- ANTWORT: 1. Preis, 2. Feedback
- Soll der Dream-Deal-Score auch für `WORKING`-Listings berechenbar sein (dort gibt's keine Repairability), oder ist Dream-Deal konzeptionell nur für Defekt-Listings mit hohem Reparaturpotenzial gedacht?
- ANTWORT: Der DDS soll nur für Working-Listings existieren, nicht für defekte
- "Deutlich höhere Schwelle" — als Startwert reicht mir ein Vorschlag (z. B. Score-Perzentil oder fester Aufschlag), aber sag mir, falls du schon eine ungefähre Hausnummer im Kopf hast (z. B. "muss mindestens 20 Prozentpunkte über der normalen Schwelle liegen").
- ANTWORT: Ein Startwert für dem DDS wäre ein Deal-Score von 15%
---

## C2 – Fehltreffer melden & automatisch filtern (mit Sicherheitsnetz)

**Ziel:** Nutzer aus der Allowlist können per 🚫-Reaction + anschließender Textnachricht (kein Slash-Command) einen Ausschlussbegriff einreichen; der Bot prüft ihn gegen alle Modell-Aliase (Substring + Levenshtein) und lehnt ihn ab, wenn er einen legitimen Alias treffen würde. Erfolgreiche Begriffe landen mit Metadaten in einer überprüfbaren Liste, mit seltenem Admin-Command für Review/Undo.

**Betroffene Dateien:**
- `src/domains/gpu/config/exclusionTerms.ts` (aktuell zwei statische, globale Arrays — muss um eine **dritte, laufzeit-erweiterbare** Quelle ergänzt werden, da die bestehenden Arrays reine Code-Konstanten ohne Persistenz sind)
- Neu: `src/domains/gpu/domain/runtimeExclusions.ts` (Laden/Speichern der laufzeit-gemeldeten Begriffe, mit Metadaten)
- `src/domains/gpu/domain/filterEngine.ts` (`resolveHealth()`/`exclusionTerms`-Check um die neue Laufzeit-Liste erweitern)
- Neu: `src/domains/gpu/domain/aliasSimilarity.ts` (Levenshtein-Distanz-Prüfung gegen alle `profile.aliases`, kein neues Package — ca. 15 Zeilen Standard-Algorithmus)
- `src/integrations/discord/notifier.ts` (Message-Collector-Flow nach 🚫-Reaction, Bearbeiten der Original-Nachricht)
- `src/integrations/discord/reactionRouter.ts` (Handler für `type: 'exclusion-report'`)
- Neuer Admin-Command (z. B. `/exclusions review` und `/exclusions undo <id>`) in `notifier.ts`, gated über `isAdminUser()` (bereits vorhanden)

**Abhängigkeiten:** A7 (Reactions/Allowlist), A4 (Property-Tests um `aliasMatcher`, damit die neue Similarity-Prüfung auf getesteter Basis aufbaut, nicht auf ungetesteter Matching-Logik).

**Abweichungen von den Annahmen:** Der Auftrag nannte `exclusionTerms.ts` als zentrale Exclusion-Datei — sie ist aber statisch und nicht runtime-erweiterbar (siehe Recherche). Die neue Laufzeit-Liste muss **separat** persistiert werden (eigene JSON-Datei oder neues Feld in `scanner-state.json`), die statischen Arrays bleiben unverändert als "eingebaute" Basis-Exclusions.

**Konkrete Umsetzungsschritte:**
1. `src/gpu-search/domain/runtimeExclusions.ts`: Datenmodell
   ```ts
   interface RuntimeExclusion {
     id: string; // uuid oder einfacher Zähler
     term: string;
     reportedAt: string;
     reportedByUserId: string;
     originalListingId: string;
     originalListingTitle: string;
     status: 'active' | 'reverted';
   }
   ```
   Persistiert in einer neuen Datei `data/runtime-exclusions.json`, geschrieben über `writeFileAtomic` aus A2 (Wiederverwendung, kein neues Ad-hoc-Schreibmuster).
2. `src/domains/gpu/domain/aliasSimilarity.ts`: einfache Levenshtein-Implementierung (Standard-DP-Algorithmus, keine Bibliothek) plus Funktion `wouldBlockLegitimateAlias(term: string, profiles: GpuProfile[]): { profile: GpuProfile; alias: string } | null` — prüft Substring-Match (`term` ist Substring eines Alias oder umgekehrt) und Levenshtein-Distanz unterhalb eines Schwellwerts (z. B. `distance <= 2` bei kurzen Aliasen, relativ zur Alias-Länge skaliert).
3. `filterEngine.ts`/`resolveHealth()`: `exclusionTerms`-Array zur Laufzeit um `runtimeExclusions.filter(e => e.status === 'active').map(e => e.term)` erweitern (gemergt beim Modul-Start und nach jeder Reaktion neu geladen, kein Restart nötig).
4. Discord-Flow in `notifier.ts`:
   - 🚫-Reaction auf Alert-Nachricht (durch `reactionRouter` erkannt, nur für Allowlist-User) → Original-Nachricht editieren (Embed-Titel/Farbe auf "❌ Als Fehltreffer gemeldet" setzen, analog zu bestehendem `markUnavailable()`-Pattern).
   - Bot antwortet im selben Channel mit Bitte um den Ausschlussbegriff, startet einen `channel.createMessageCollector({ filter: m => m.author.id === user.id, time: 120_000, max: 1 })` (discord.js-Standard, kein neues Package).
   - Bei Eingang: `wouldBlockLegitimateAlias()` prüfen. Bei Treffer: Ablehnung mit konkretem Grund posten ("das würde auch echte {alias}-Angebote von {profile.name} blockieren – bitte spezifischer"). Bei Nicht-Treffer: `RuntimeExclusion` anlegen, Bestätigung posten.
   - Timeout (keine Antwort in 120s): Bot postet kurzen Hinweis, dass die Meldung verworfen wurde.
5. Admin-Commands: `/exclusions review` (listet aktive `RuntimeExclusion`s der letzten N Tage), `/exclusions undo <id>` (setzt `status: 'reverted'`) — gated über `isAdminUser()`, wie bestehende `CONFIG_COMMAND`/`DELETE_COMMAND` (Pattern 1:1 übernehmbar).

**Teststrategie:**
- `aliasSimilarity.test.ts`: Levenshtein-Grundfälle (`distance('kitten','sitting') === 3` als Sanity-Check), plus die konkrete Beispiel-Property aus dem Auftrag ("3070Ti" wird bei Alias "RTX 3070 Ti" abgelehnt, "ohne Kühler" nicht).
- `runtimeExclusions.test.ts`: Anlegen/Laden/Revert-Zyklus, atomare Persistenz (nutzt A2-Utility, kein separater Atomic-Test nötig, nur Aufruf-Verifikation).
- `filterEngine.test.ts`: neuer Fall, dass ein Listing, das einen aktiven Runtime-Exclusion-Term enthält, als `EXCLUDED` markiert wird, ein `reverted`-Term dagegen nicht mehr.
- Manueller Discord-Test: kompletter Flow von 🚫 bis Bestätigung/Ablehnung, inkl. Timeout-Fall.

**Risiken/Rollback:** Mittel — falsches Ablehnungs-Tuning (Levenshtein-Schwelle zu locker/streng) könnte entweder legitime Begriffe durchlassen oder alles blockieren. Mitigation: Schwellwert konfigurierbar über Env (`EXCLUSION_SIMILARITY_MAX_DISTANCE`, Default z. B. `2`), erste Zeit mit den zwei/drei bekannten Nutzern beobachten. Rollback: `RUNTIME_EXCLUSIONS_ENABLED=false`, Datei bleibt bestehen für spätere Reaktivierung.

**Offene Fragen an dich:**
- Soll der Ausschlussbegriff **global** gelten (für alle Profile, wie die bestehenden statischen `exclusionTerms`) oder **pro Profil** scoped (nur für das Profil, dessen Alert gemeldet wurde)? Der Auftrag spricht von "das ausschließende Wort/die Wortgruppe" ohne Profil-Scoping zu erwähnen, aber pro-Profil wäre chirurgischer und würde das Kollisionsrisiko mit anderen Profilen automatisch reduzieren.
- ANTWORT: Pro Profil
- Wie soll die Levenshtein-Schwelle grob kalibriert sein — eher konservativ (viele Ablehnungen, wenig Fehlklassifikation) oder eher permissiv (schnellere Ausschlüsse, Risiko einzelner blockierter legitimer Treffer, die dann über den Admin-Undo korrigiert werden)?
- ANTWORT: permissiv
---

## D – Auktions-Sniper-Reminder

**Ziel:** Auf Alerts für Auktions-Listings kann per ⏰-Reaction ein einmaliger Reminder kurz vor Auktionsende geplant werden, der den Preis/Gebotsstand frisch abruft, bevor er postet; Reminder überleben Prozess-Neustarts und werden sauber storniert, wenn das Listing vorher verschwindet.

**Betroffene Dateien:**
- `src/domains/gpu/domain/scannerState.ts` (neues Feld `auctionReminders: AuctionReminder[]` im State-Schema, plus `itemEndDate` in `SeenRecord` ergänzen — fehlt aktuell)
- `src/domains/gpu/application/scanner.ts` (`itemEndDate` beim Anlegen eines `SeenRecord` mitschreiben)
- `src/domains/gpu/application/scanScheduler.ts` (neuer, dritter Scheduler-Tick für fällige Reminder, analog zum bestehenden `startAvailabilityRefreshLoop()`-Pattern in `module.ts`)
- `src/domains/gpu/infrastructure/ebay/client.ts` (Wiederverwendung von `checkListingAvailability()`/der Single-Item-Abfrage für den frischen Preis-Check kurz vor Ablauf)
- `src/integrations/discord/reactionRouter.ts` (Handler für `type: 'auction-reminder'`)
- `src/integrations/discord/notifier.ts` (Reminder-Nachricht senden, Stornierungs-Info senden)

**Abhängigkeiten:** A7 (Reactions/Allowlist), A2 (atomare Persistenz für die neue Reminder-Liste), A5 (Scheduler-Robustheit für den neuen dritten Tick).

**Abweichungen von den Annahmen:** Der Auftrag nimmt an, dass die Endzeit bereits im State verfügbar ist ("Endzeit ist also schon bekannt") — das stimmt nur für den Moment der Filterentscheidung (`EbayListing.itemEndDate` zur Scan-Zeit), wird aber aktuell **nicht** in `SeenRecord`/`ObservationRecord` persistiert. Das muss als Schema-Erweiterung ergänzt werden, sonst ist beim späteren Reaction-Handling die Endzeit nicht mehr verfügbar.

**Konkrete Umsetzungsschritte:**
1. `SeenRecord`-Interface um `itemEndDate?: string` erweitern; in `scanner.ts`, an der Stelle, wo `SeenRecord`s beim Senden eines Alerts angelegt werden, `listing.itemEndDate` mitschreiben (Version-Bump des State-Schemas, mit Migration wie bei B5 — fehlendes Feld beim Laden alter Einträge → `undefined`, Reminder-Reaction für solche alten Alerts wird dann einfach mit einer Fehlermeldung abgelehnt statt zu crashen).
2. Neues State-Feld `auctionReminders: { itemId: string; profileName: string; remindAt: string; channelId: string; userId: string; messageId: string; status: 'pending' | 'fired' | 'cancelled' }[]`.
3. ⏰-Reaction-Handler (`reactionRouter`): liest `itemEndDate` aus dem zugehörigen `SeenRecord`, berechnet `remindAt = itemEndDate - reminderLeadMinutes` (Env-Var `AUCTION_REMINDER_LEAD_MINUTES`, Default z. B. `7`, mittig im geforderten 5-10-Minuten-Fenster), legt Eintrag an, bestätigt per kurzer Antwort ("Reminder gesetzt für HH:MM").
4. Neuer Scheduler-Tick in `module.ts` (analog `startAvailabilityRefreshLoop`, **nicht** rohes `setTimeout` pro Reminder — wie im Auftrag gefordert, ein einzelner wiederkehrender Tick, der alle fälligen Reminder prüft, damit Neustarts nichts verlieren): alle z. B. 60 Sekunden `getListingsDueForReminder(now)` aus `scannerState.ts` abfragen (analog zu `getListingsDueForAvailabilityCheck`), für jeden fälligen Reminder:
   - `checkListingAvailability(itemId)` aufrufen (bestehende Funktion aus `client.ts`, liefert aktuellen Zustand/Preis).
   - Falls Listing verschwunden/nicht mehr verfügbar: Stornierungs-Info posten ("Auktion ist nicht mehr verfügbar, Reminder storniert"), Status auf `cancelled`.
   - Sonst: frischen Preis/Gebotsstand in einer neuen, kurzen Nachricht posten ("⏰ Auktion endet in 7 Min, aktueller Preis: X €"), Status auf `fired`.
5. Dieser Tick braucht eigenes try/catch pro Durchlauf (Konsistenz mit A5 — ein einzelner fehlgeschlagener Reminder-Check darf nicht die anderen fälligen Reminder in derselben Batch verhindern, also try/catch **pro Reminder-Item**, nicht nur um den ganzen Tick).

**Teststrategie:**
- `scannerState.test.ts`: `getListingsDueForReminder()` liefert nur Einträge mit `status: 'pending'` und `remindAt <= now`; nach Abarbeitung ändert sich der Status korrekt.
- Neuer Test in `scanScheduler.test.ts` oder eigene Datei: simulierter Reminder-Tick mit gemocktem `checkListingAvailability`, einmal "noch verfügbar" (→ Preis-Nachricht), einmal "nicht mehr verfügbar" (→ Stornierung), einmal wirft die Verfügbarkeitsprüfung einen Fehler (→ wird geloggt, andere Reminder im selben Batch laufen trotzdem durch).
- Manueller Test: ⏰ auf eine simulierte Auktions-Alert-Nachricht mit `remindAt` in der nahen Zukunft (z. B. über `SCANNER_STATE_PATH`-Testfixture mit künstlich naher `itemEndDate`), prüfen dass die Reminder-Nachricht rechtzeitig erscheint.

**Risiken/Rollback:** Gering-mittel — zusätzliche eBay-API-Calls (ein Availability-Check pro Reminder), aber Volumen ist bei einer Zwei-Personen-Nutzergruppe vernachlässigbar. Rollback: `AUCTION_REMINDER_ENABLED=false`, bestehende `auctionReminders`-Einträge werden dann einfach nicht mehr abgearbeitet (kein Datenverlust, nur pausiert).

**Offene Fragen an dich:**
- `AUCTION_REMINDER_LEAD_MINUTES` als einzelner globaler Wert (5-10 Min laut Auftrag) — reicht ein fester Default, oder soll das pro Reaction einstellbar sein (z. B. über eine Zahlen-Reaction-Auswahl)? Ich empfehle einen festen globalen Wert (ponytail: keine zusätzliche UI für einen Rand-Fall bauen, der bei zwei Nutzern kaum gebraucht wird) — sag Bescheid, falls du das anders siehst.
- ANTWORT: Einzelner globaler Wert -> 20 Minuten
- Wenn zwei verschiedene Allowlist-User auf denselben Alert mit ⏰ reagieren: ein gemeinsamer Reminder (an den Channel) oder zwei getrennte (jeweils nur für den reagierenden User sichtbar, z. B. per DM)? Der Auftrag erwähnt `userId` im Datenmodell, was auf getrennte Reminder pro User hindeutet — bitte bestätigen.
- ANTWORT: Gemeinsam
---

## A6 – Liquipedia-API-Konformität

**Ziel:** Zu klären, bevor Umsetzung beginnt (siehe Abweichung 4 oben) — der im Auftrag beschriebene Zustand ("Liquipedia wird bereits genutzt") trifft nicht zu.

**Betroffene Dateien (falls Option A gewählt wird — siehe unten):**
- `src/domains/valorant/ingest/sources/liquipediaMediaWikiClient.ts` (Caching + robusteres Backoff ergänzen, auch wenn aktuell unbenutzt)

**Betroffene Dateien (falls Option B gewählt wird):**
- `src/domains/valorant/providers/vlr/provider.ts` (VLR ist eine Website ohne offizielle API — hier ginge es dann nicht um "API-Konformität" im engeren Sinn, sondern um respektvolles Scraping: Caching, User-Agent, Backoff, ähnliches Prinzip aber andere rechtliche Grundlage)

**Abhängigkeiten:** Keine technischen, aber eine inhaltliche Grundsatzentscheidung von dir.

**Konkrete Umsetzungsschritte:** Bewusst nicht ausformuliert, bis die offene Frage beantwortet ist — ich will hier nicht in eine Richtung planen, die am Ende nicht gebraucht wird.

**Teststrategie:** Abhängig von der Antwort.

**Risiken/Rollback:** Abhängig von der Antwort.

**Offene Fragen an dich:**
- Der Liquipedia-Client ist aktuell kompletter toter Code (nirgends instanziiert). Drei Optionen: **(A)** Liquipedia-Client trotzdem konform ausbauen (Caching mit TTL, Backoff bei 429/503) als Vorbereitung für eine spätere Aktivierung, obwohl er aktuell nichts bewirkt. **(B)** Stattdessen die tatsächlich aktive VLR-Anbindung (`provider.ts`, scraped `www.vlr.gg`) robuster/freundlicher machen (Caching, ordentlicher User-Agent, Backoff) — das ist der Code, der täglich wirklich läuft. **(C)** Beides. Was soll ich umsetzen?
- ANTWORT: Nichts, wir ignorieren den toten Code erstmal
- Falls (A) oder (C): gibt es einen konkreten Plan, Liquipedia als zusätzliche/alternative Quelle zu VLR zu aktivieren? Falls nicht, wäre der Aufwand für toten Code vermutlich besser in (B) investiert.
- ANTWORT: Nichts, wir ignorieren den toten Code erstmal
---

## B6 – Semantisches Alias-Fallback

**Ziel:** Wenn `aliasMatcher` keinen regelbasierten Treffer findet, versucht ein lokal laufendes Embedding-Modell (kein API-Call, keine laufenden Kosten) einen semantischen Fallback-Treffer; alle Fallback-Treffer werden geloggt, um die Alias-Liste später manuell zu pflegen.

**Betroffene Dateien:**
- `package.json` (neue Dependency für lokale Embeddings, z. B. `@xenova/transformers` — läuft komplett lokal über WASM/ONNX, kein Netzwerkaufruf zur Inferenzzeit)
- Neu: `src/domains/gpu/domain/semanticAliasFallback.ts`
- `src/domains/gpu/domain/profileMatcher.ts` (Fallback-Aufruf nur, wenn `selectProfileForListing()` `null` liefert)
- Neu: `data/semantic-fallback-log.json` (oder Ergänzung in `scanner-state.json`) für die geforderte Logging-Liste

**Abhängigkeiten:** A4 (Property-Tests/Testkorpus als Grundlage, um Fallback-Trefferqualität überhaupt bewerten zu können).

**Abweichungen von den Annahmen:** Keine bestehende Fuzzy-/Similarity-Logik im Repo (siehe Recherche A4) — das hier ist die erste. Modell-Download beim ersten Lauf (aus Hugging Face Hub) nötig, danach lokal gecacht — das ist kein laufender API-Call, aber initial ein Netzwerkzugriff, was ich explizit als Punkt für dich markiere, weil "kein API-Call" im Auftrag betont wurde.

**Konkrete Umsetzungsschritte:**
1. `@xenova/transformers` installieren (bewusste Wahl: pure-JS/WASM, kein Python-Prozess, kein GPU nötig — passt zu `node:22-bookworm-slim` ohne zusätzliche System-Dependencies).
2. Kleines, quantisiertes Sentence-Embedding-Modell wählen (z. B. `Xenova/all-MiniLM-L6-v2`, ~25MB quantisiert) — Modell wird beim ersten Aufruf lokal in einen Cache-Ordner geladen (Pfad über `env.TRANSFORMERS_CACHE` konfigurierbar machen, damit der Docker-Container einen persistenten Layer/Volume dafür hat und nicht bei jedem Neustart neu herunterlädt).
3. `semanticAliasFallback.ts`: beim ersten Aufruf pro Prozess-Laufzeit alle `profile.aliases` (aus allen Profilen) einmalig embedden und cachen (In-Memory, kein Neu-Embedden pro Listing). Pro nicht gematchtem Listing: Titel embedden, Cosine-Similarity gegen alle Alias-Embeddings, höchster Wert über einem konfigurierbaren Schwellwert (`env.SEMANTIC_FALLBACK_MIN_SIMILARITY`, Default z. B. `0.75`) → Fallback-Match.
4. Bei Fallback-Match: Eintrag in `semantic-fallback-log.json` (Listing-Titel, gewähltes Profil, Similarity-Score, Zeitstempel) über `writeFileAtomic` aus A2. **Kein automatisches Akzeptieren** in die reguläre Pipeline ohne expliziten Hinweis — siehe offene Frage, ob Fallback-Treffer überhaupt live alarmieren sollen oder erstmal nur geloggt werden, bis manuell geprüft.
5. Performance: Embedding-Inferenz pro Listing kostet spürbar mehr Zeit als reines String-Matching (WASM-Inferenz typischerweise einige zig Millisekunden) — nur aufrufen, wenn der reguläre Matcher wirklich `null` liefert (seltener Pfad), nicht pro Listing pauschal.

**Teststrategie:**
- `semanticAliasFallback.test.ts`: mit einem festen, kleinen Testkorpus prüfen, dass offensichtlich verwandte Titel (z. B. "3070ti" ohne Leerzeichen/Sonderzeichen, falls das der reguläre Matcher tatsächlich verpasst) einen Fallback-Treffer bekommen, offensichtlich unverwandte (z. B. "Playstation 5") keinen.
- Kein Anspruch auf exakte Similarity-Werte in Tests (Modellversionen können leicht variieren) — Tests prüfen nur "über/unter Schwelle", nicht exakte Zahlen.

**Risiken/Rollback:** Mittel-hoch — größte Unbekannte im ganzen Plan: Nutzen unklar, bis es in der Praxis Fälle gibt, die der bestehende `aliasMatcher` (der schon recht robust normalisiert/brand-strippt) wirklich verpasst. **Ponytail-Einwand, den ich dir explizit zur Prüfung vorlege:** Bevor wir ein Embedding-Modell + neue Dependency + Docker-Volume für Modell-Cache einbauen, lohnt sich ein kurzer Blick in die Praxis — habt ihr konkrete Beispiele aus den letzten Monaten, wo `aliasMatcher` einen Titel verpasst hat, den ein Mensch klar zugeordnet hätte? Falls es solche Fälle kaum gibt, wäre eine einfachere, regelbasierte Erweiterung (z. B. zusätzliche Normalisierungsregeln für Leetspeak/Tippfehler-Muster, ähnlich der bereits bestehenden Brand-Strip-Logik) vermutlich der günstigere erste Schritt, bevor man zur Embedding-Lösung greift.

**Offene Fragen an dich:**
- Hast du konkrete Beispiele von Listings, die `aliasMatcher` in der Vergangenheit verpasst hat und die ein Embedding-Modell vermutlich gefangen hätte? Das würde mir helfen, den Schwellwert realistisch zu setzen statt zu raten.
- ANTWORT: Nein
- Sollen Fallback-Treffer **live alarmieren** (wie ein normaler Treffer) oder zunächst **nur geloggt** werden, bis du sie manuell in echte Aliase überführst? Ich empfehle zunächst nur Logging (geringeres Risiko von False Positives, die dann als "komischer Alert" auffallen), aber das ist deine Entscheidung.
- ANTWORT: Logging
- Bist du einverstanden mit einem initialen Modell-Download aus dem Hugging-Face-Hub beim ersten Container-Start (danach lokal gecacht), oder muss das Modell vollständig ins Docker-Image vorgebaut/vendored sein (kein Netzwerkzugriff zur Laufzeit, auch nicht beim ersten Start)?
- ANTWORT: Das was du als schlauer betrachtest
---

## B2 – Deal-Timing-Orakel

**Ziel:** Über die eBay Marketplace Insights API (echte Sold-Comps statt nur aktiver Angebote) plus einem einfachen Trendindikator pro Profil bekommen Alerts eine Kauf-jetzt-oder-warten-Einschätzung.

**Betroffene Dateien:**
- `src/domains/gpu/infrastructure/ebay/client.ts` (neue Funktion für Marketplace-Insights-Abfrage, analog zum bestehenden Browse-API-Client)
- `src/domains/gpu/infrastructure/ebay/oauth.ts` (ggf. zusätzlicher OAuth-Scope nötig — Marketplace Insights nutzt einen anderen Scope als Browse API)
- `src/domains/gpu/domain/messageFormatter.ts` (neues Feld/Zeile in der Alert-Nachricht: "Kauf jetzt" / "eher warten")
- `src/domains/gpu/domain/models.ts` (neuer Typ `DealTimingAssessment`)

**Abhängigkeiten:** A3 (Observability, um die neue API-Fehlerrate von Anfang an sichtbar zu haben) — ansonsten unabhängig.

**Abweichungen von den Annahmen:** Die eBay Marketplace Insights API ist **keine Standard-Scope-API** — sie erfordert laut eBay-Entwicklerdokumentation eine gesonderte Freischaltung ("Limited Release", Antrag über den eBay Developer Support nötig, nicht automatisch mit einem normalen App-Key verfügbar). Das ist ein externes Blocker-Risiko, das vor jeder Codeplanung geklärt werden muss.

**Konkrete Umsetzungsschritte:** Bewusst nur grob skizziert, bis die API-Zugriffsfrage geklärt ist:
1. Zugriff auf Marketplace Insights API beim eBay Developer Account beantragen/verifizieren (extern, außerhalb des Coding-Scopes).
2. Neue Client-Funktion `fetchSoldComps(query, days)` in `client.ts`, die die `/buy/marketplace_insights/v1_beta/item_sales/search`-Endpunkt-artige Abfrage kapselt (exakter Endpunkt-Name muss anhand der dann verfügbaren Doku verifiziert werden, nicht raten).
3. Trendindikator: einfacher gleitender Vergleich (z. B. Durchschnittspreis letzte 7 Tage vs. letzte 30 Tage der Sold-Comps) — kein ML-Modell nötig für einen simplen Trend (ponytail: Prozent-Differenz zweier Durchschnittswerte reicht als erster Indikator).
4. Ergebnis in `messageFormatter.ts` als zusätzliche Zeile einbauen ("📈 Trend: Preise stabil, aktuell guter Zeitpunkt" o.ä., grob dreistufig: "jetzt kaufen" / "neutral" / "eher abwarten").

**Teststrategie:** Abhängig vom finalen Endpunkt-Contract — Unit-Tests mit gemockten API-Antworten für die Trend-Berechnung selbst sind unabhängig von der Freischaltungsfrage schon vorbereitbar.

**Risiken/Rollback:** Hoch, bis externe Freischaltung geklärt ist — ohne API-Zugriff ist das Feature nicht umsetzbar wie beschrieben. Fallback-Option: Trendindikator stattdessen auf Basis der bereits vorhandenen `ObservationRecord`-Historie (eigene bisher gesehene Angebote, kein Sold-Comps) berechnen — deutlich schwächeres Signal (keine echten Verkäufe, nur eigene Beobachtungen), aber ohne externe Freischaltung sofort umsetzbar.

**Offene Fragen an dich:**
- Hast/bekommst du Zugriff auf die eBay Marketplace Insights API (Limited-Release-Antrag gestellt/genehmigt)? Falls nicht: soll ich stattdessen die schwächere Fallback-Variante auf Basis der eigenen `ObservationRecord`-Historie umsetzen, oder das Feature komplett zurückstellen, bis der Zugriff da ist?
- ANTWORT: Auf die eigene ObservationRecord-Historie
---

## B4 – Cross-Marketplace-Arbitrage mit echter Margen-Rechnung

**Ziel:** Eine zweite Marktplatz-Quelle wird über dieselbe Bucket-/Matching-Engine angebunden; Alarm nur bei echtem Gewinn-Spielraum (Kaufpreis + Versand + Kosten vs. realistischem Wiederverkaufswert aus Sold-Comps).

**Betroffene Dateien:**
- Neu: `src/domains/gpu/infrastructure/<marketplace>/` (neue Infrastructure-Schicht, gespiegelt zu `infrastructure/ebay/`)
- `src/domains/gpu/domain/profileMatcher.ts`/`filterEngine.ts` (Wiederverwendung bestätigt möglich — beide Funktionen sind bereits generisch auf `EbayListing`-artige Objekte ausgelegt, bräuchten aber eine Verallgemeinerung des Typs, z. B. `MarketplaceListing` statt `EbayListing`, da der Name aktuell eBay-spezifisch ist)
- `src/domains/gpu/domain/models.ts` (Umbenennung/Verallgemeinerung von `EbayListing` — **Breaking-Change-Risiko**, betrifft sehr viele Dateien)
- Margen-Rechnung: baut auf B2 (Sold-Comps) auf

**Abhängigkeiten:** B2 muss zuerst stehen (Margen-Rechnung braucht Sold-Comps-Zugriff).

**Abweichungen von den Annahmen:** Keine direkten, aber der Umfang ist deutlich größer als bei den anderen Punkten — eine zweite Marktplatz-Quelle bedeutet einen neuen `infrastructure`-Adapter plus eine Verallgemeinerung des bisher eBay-spezifischen Datenmodells (`EbayListing` ist heute tief in `filterEngine.ts`, `profileMatcher.ts`, `scanner.ts` verwoben).

**Konkrete Umsetzungsschritte:** Bewusst grob, da dieser Punkt der aufwändigste im ganzen Plan ist und von zwei vorherigen, noch offenen Punkten (B2, plus einer konkreten zweiten Marktplatz-Wahl) abhängt:
1. Konkrete zweite Marktplatz-Quelle festlegen (siehe offene Frage — der Auftrag nennt keine).
2. `EbayListing` in `models.ts` in ein generisches `MarketplaceListing`-Interface umbenennen/extrahieren, mit `source: 'ebay' | '<neu>'` als Discriminator; `EbayListing` als Alias/Extends beibehalten, um bestehenden Code nicht überall anfassen zu müssen (ponytail: Type-Alias statt Rename an 20 Call-Sites).
3. Neuer Infrastructure-Adapter für die zweite Quelle, der auf denselben `SearchBucket`-Query-Mechanismus abgebildet wird (`searchBuckets.ts` müsste um marktplatz-spezifische Query-Syntax erweitert werden — eBay-Query-Syntax ist nicht 1:1 auf andere Marktplätze übertragbar, das ist der Kern der Arbeit hier).
4. Margen-Berechnung: `kaufpreis + versand + geschätzte Kosten (Versand-Weiterverkauf, eBay-Gebühren o.ä.) vs. B2-Sold-Comps-Durchschnitt` — nur alarmieren, wenn Marge über konfigurierbarem Mindestwert (`env.ARBITRAGE_MIN_MARGIN_EUR` oder -Prozent).

**Teststrategie:** Analog zu bestehenden `filterEngine.test.ts`-Mustern, aber für den neuen Marktplatz-Adapter isoliert testbar (Mock-HTTP wie bereits bei eBay in `http.test.ts` vorhanden).

**Risiken/Rollback:** Hoch — größter Einzelpunkt im Plan, echtes Risiko für Breaking Changes am Kern-Datenmodell. Empfehlung: als eigener, expliziter Zwischen-Freigabeschritt behandeln (nicht "ein Commit", sondern mehrere kleine PRs: erst Typ-Verallgemeinerung isoliert, dann neuer Adapter, dann Margen-Logik).

**Offene Fragen an dich:**
- Welche zweite Marktplatz-Quelle konkret (Kleinanzeigen? Willhaben? Ein zweiter eBay-Marketplace wie `EBAY_AT`?)? Das ändert den gesamten Adapter-Scope massiv (offizielle API vs. Scraping-Grauzone mit eigenen ToS-Risiken analog zu VLR).
- ANTWORT: Kleinanzeigen
- Ist dir der Umfang bewusst, dass dieser Punkt eine Verallgemeinerung des zentralen `EbayListing`-Typs erfordert, die (mit Typ-Alias-Absicherung) zwar risikoarm gestaltet werden kann, aber dennoch der invasivste Einzelschritt im gesamten Plan ist? Falls das mehr ist, als du aktuell willst, könnten wir B4 auch komplett zurückstellen und den Plan ohne ihn freigeben.
- ANTWORT: ist mir bewusst
---

## Zusammenfassung: was du mir als Nächstes bestätigen musst

Damit ich in Phase 2 ohne Rückfragen loslegen kann, brauche ich Antworten auf mindestens:
1. A1: Docker Compose ja/nein, welche Secrets genau.
2. A2: `data/` versioniert?, gemeinsamer Backup-Count?
3. A3: Prometheus-Pull oder OTLP-Push, Port/Erreichbarkeit.
4. A4: echte Beispieltitel oder synthetisch?
5. A7: `ALLOWED_REACTOR_IDS` = `DISCORD_ADMIN_USER_IDS` oder eigene Gruppe?, Admin-IDs auch auf Env umstellen?
6. B5: Bias auf alle 4 Preisfelder oder gezielt?, Info-Nachricht als neue Nachricht oder Edit?
7. C1: Gewichtung der drei Signale, Dream-Deal für WORKING-Listings auch?, ungefähre Schwellen-Hausnummer.
8. C2: Global vs. profil-scoped Exclusions, Levenshtein-Kalibrierung konservativ vs. permissiv.
9. D: fester vs. konfigurierbarer Lead-Time, gemeinsamer vs. getrennter Reminder pro User.
10. A6: Toter Liquipedia-Client ausbauen vs. aktiven VLR-Scraper härten vs. beides.
11. B2: Marketplace-Insights-API-Zugriff vorhanden/beantragt? Fallback auf eigene Historie akzeptabel, falls nicht?
12. B4: Welche zweite Marktplatz-Quelle konkret?, Umfang der Datenmodell-Verallgemeinerung akzeptiert?
13. B6: Konkrete verpasste Beispiele vorhanden?, Live-Alarm oder nur Logging?, Modell-Download zur Laufzeit akzeptabel oder vollständig vendored nötig?
