# KI-Agent: Architektur (Phase 1)

Stand: 3. September 2026 · Umgesetzt: Phase 1 und Phase 2 des
[Umsetzungsplans](../gpu-search-claude-discord-umsetzungsplan-ein-bot.md).

## Ein Bot, ein Client, ein Login

```mermaid
flowchart TD
    U["Erlaubter Discord-Nutzer"] --> RT["DiscordRuntime\neinziger Client, einziges login()"]
    RT --> CR["CommandRouter\nNotifier zuerst, danach KI"]
    CR --> NO["DiscordNotifier\nCommands, Reactions, Reminder"]
    CR --> AI["AiMessageRouter\nAllowlist + Mention-Pflicht"]
    AI --> RCS["RequestContextStore\nunveraenderliche Request-ID"]
    RCS --> SOCK["AgentSocketServer\nUnix-Socket, 0600"]
    SOCK <--> SC["Channel-Sidecar\nohne Discord-Token"]
    SC <--> CC["Claude Code\nAbo-Login"]
    SOCK --> EX["AdminToolExecutor\nPolicy + Freigabe + Audit"]
    EX --> RT
```

## Komponenten

| Datei | Aufgabe |
|---|---|
| `src/integrations/discord/runtime/discordRuntime.ts` | Besitzt den einzigen `Client`. `login()` ist idempotent und ruft `client.login()` genau einmal auf. |
| `src/integrations/discord/routing/commandRouter.ts` | Fan-out für `messageCreate`/`interactionCreate` in Registrierungsreihenfolge, mit Fehlerisolation. Der erste Handler, der `true` liefert, beendet die Kette. |
| `src/integrations/discord/routing/reactionRouter.ts` | Unveränderter Emoji-Dispatcher (B5/C1/C2/D). |
| `src/integrations/discord/routing/aiMessageRouter.ts` | Torwächter: Guild, Channel-Allowlist, User-Allowlist, Mention-Pflicht, keine Bots/Webhooks, kein laufender Notifier-Dialog. |
| `src/integrations/discord/ai/requestContextStore.ts` | Erzeugt pro zugelassener Nachricht eine eingefrorene Request-ID mit Absender, Guild, Channel, Message-ID und Ablaufzeit. |
| `src/integrations/discord/ai/agentSocketServer.ts` | Unix-Socket (0600) mit Secret-Handshake und NDJSON-Frames. |
| `src/integrations/discord/ai/toolPolicy.ts` | Deterministische Risikomatrix. Default-Deny für unbekannte Tools. |
| `src/integrations/discord/ai/approvalService.ts` | Argumentgebundene, einmalige, ablaufende Owner-Freigaben. |
| `src/integrations/discord/ai/adminToolExecutor.ts` | Führt Tools aus – erst nach Kontext, Guild-Prüfung, Policy, Schema-Validierung, Registrierung und Freigabe. |
| `src/integrations/discord/ai/readTools.ts` | Phase 2: die 14 lesenden Werkzeuge inklusive harter Limits und Projektionen. |
| `src/integrations/discord/ai/auditLog.ts` | Append-only JSONL mit Redaction. |
| `src/integrations/discord/ai/agentModule.ts` | Kompositionswurzel; wird von `bootstrap.ts` nur bei `AI_AGENT_ENABLED=true` gestartet. |
| `tools/claude-gpu-search-channel/` | Sidecar ohne Discord-Abhängigkeit und ohne Token. |

## Vertrauensgrenze

Der GPU-Search-Prozess entscheidet allein. Sidecar und Claude bekommen:

- die `requestId` (Zufalls-UUID) und den Nachrichtentext,
- niemals Bot-Token, Absender-ID oder Guild-ID als schreibbares Argument.

`AdminToolExecutor` entfernt `guild_id`, `guildId`, `actor`, `actorUserId`, `userId`,
`requestId` und `approvalId` aus den Toolargumenten und setzt Guild und Absender aus
Konfiguration bzw. `RequestContextStore`.

## Ablauf eines Toolaufrufs (Phase 2)

1. `AiMessageRouter` lässt die Nachricht durch → `RequestContextStore` stellt eine `requestId` aus.
2. Der Sidecar bekommt `inbound_message` mit `requestId` und Text — sonst nichts.
3. Claude ruft ein Werkzeug **unter seinem eigenen Namen** auf (`list_roles`, …). Der
   Sidecar bildet das auf `admin_tool_request` ab; den Katalog holt er per `list_tools`
   vom Hauptprozess und führt bewusst keine eigene Liste.
4. `AdminToolExecutor` prüft in dieser Reihenfolge:
   Request-Kontext → Guild-Argument → Policy → Registrierung → Zod-Schema → Freigabe.
5. Der Handler liest über den zentralen `DiscordRuntime`-Client und gibt eine
   **Projektion** zurück, nie das rohe discord.js-Objekt.
6. Erfolg, Ablehnung und Fehler landen redigiert im Audit-Trail.

## Grenzen der Read-Tools

| Werkzeug | Limit |
|---|---|
| `get_messages` | max. 50, Default 25 |
| `list_members` | max. 100, Default 50 |
| `get_audit_log` | max. 50, Default 25 |
| `list_bans` | max. 100, Default 50 |

Alle Schemas sind `.strict()`: unbekannte Argumente führen zur Ablehnung. IDs müssen
Snowflakes sein (`^\d{17,20}$`).

Projektionen geben nie heraus: Webhook-`token`/`url`, vollständige Invite-Codes
(nur `abc***`), Avatar-/Banner-URLs. Audit-Log-`changes` laufen durch dieselbe
Redaction wie der eigene Audit-Trail.

## Was noch offen ist

- Schreibende Werkzeuge und die Owner-DM mit Allow-/Deny-Buttons fehlen;
  `AdminToolExecutorOptions.requestApproval` ist der vorgesehene Einhängepunkt (Phase 3).
- Geschützte Rollen/Channels (`AI_PROTECTED_*`) werden erst mit den Writes durchgesetzt.
- Destruktive Werkzeuge sind nicht registrierbar (Phase 4).
- Die Frame-Namen des stdio-Kanals sind noch nicht gegen den gepinnten Upstream-Commit
  des offiziellen Plugins abgeglichen (siehe `tools/claude-gpu-search-channel/THIRD_PARTY_NOTICES.md`).
