# KI-Agent: Bedrohungsmodell

Stand: 3. September 2026

Ausgangslage: Es gibt **eine** Bot-Identität. Scanner- und Admin-Funktionen teilen sich
dieselbe Discord-Rolle. Der mögliche Schadensumfang eines kompromittierten Tokens ist
dadurch höher als bei zwei getrennten Bots — die Gegenmaßnahmen unten sind deshalb
Pflicht, keine Härtungsoption.

| Bedrohung | Gegenmaßnahme (Phase 1) | Test |
|---|---|---|
| Fremde Nutzer sprechen den Agenten an | User-Allowlist serverseitig, stilles Verwerfen | `aiMessageRouter.test.ts` |
| Nutzung in nicht freigegebenen Channels/Guilds | Channel- und Guild-Allowlist serverseitig | `aiMessageRouter.test.ts` |
| Prompt Injection über normale Servernachrichten | Mention-Pflicht + Allowlist; Policy liegt außerhalb des Modells | `aiMessageRouter.test.ts`, `toolPolicy.test.ts` |
| Modell gibt sich als anderer Nutzer/andere Guild aus | Identität nur aus `RequestContextStore`; reservierte Argumente werden verworfen | `adminToolExecutor.test.ts` |
| Unbekanntes oder destruktives Tool wird aufgerufen | Default-Deny, destruktive Tools ohne Feature-Flag nicht registrierbar | `toolPolicy.test.ts`, `adminToolExecutor.test.ts` |
| Freigabe wird für andere Argumente wiederverwendet | Hash über Toolname + kanonische Argumente, einmalig, TTL 5 Minuten | `approvalService.test.ts` |
| Selbstfreigabe durch den Auftraggeber | Freigabe nur durch `AI_OWNER_USER_IDS` | `approvalService.test.ts` |
| Zugriff auf den lokalen Socket durch andere Prozesse | Unix-Socket mit Modus 0600 in `data/runtime/`, zusätzlich Secret-Handshake | `agentSocketServer.test.ts` |
| Bot-Token gelangt zum Sidecar oder zu Claude | Sidecar bricht bei vererbtem Token ab, hat keine `discord.js`-Abhängigkeit | `tools/claude-gpu-search-channel/test/sidecar.test.js` |
| Secrets im Audit-Trail | Schlüssel-basierte Redaction vor dem Schreiben | `auditLog.test.ts` |
| Fehlkonfigurierter Start (aktive KI ohne Allowlist) | `validateAiAgentConfig()` wirft beim Laden von `env` | `src/app/env/index.test.ts` |
| Ausfall von Claude/Sidecar legt den Bot lahm | KI-Start ist fehlerisoliert; ohne Sidecar antwortet der Bot mit „KI-Funktion derzeit nicht verfügbar“ statt zu puffern | manuell, `bootstrap.ts` |

## Offene Risiken (Phase 2+)

- Exfiltration über Read-Tools mit zu großen Limits → harte Limits in Phase 2.
- Rollenhierarchie und geschützte Ziele (`@everyone`, Managed Roles, Bot-Rolle) werden
  erst mit den Write-Tools in Phase 3 durchgesetzt; `AI_PROTECTED_ROLE_IDS` und
  `AI_PROTECTED_CHANNEL_IDS` sind dafür bereits konfigurierbar.
- Discord-Rechte des Bots sind manuell im Developer Portal zu minimieren.
  **Keine `Administrator`-Berechtigung.**
