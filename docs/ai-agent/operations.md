# KI-Agent: Betrieb

Stand: 3. September 2026

## Zwei Prozesse, eine Bot-Identität

1. `gpu-search` (Hauptprozess) — besitzt Bot-Token, Discord-Client und Unix-Socket.
2. `claude-gpu-search-channel` + Claude Code (Sidecar) — besitzt **keine** Discord-Zugangsdaten.

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `AI_AGENT_ENABLED` | `false` | Schaltet die gesamte KI-Anbindung ein |
| `AI_GUILD_ID` | – | Einzige erlaubte Guild; wird serverseitig gesetzt |
| `AI_SOCKET_PATH` | `data/runtime/claude-channel.sock` | Unix-Socket |
| `AI_SOCKET_SECRET_FILE` | – | Datei mit dem lokalen Secret (Pflicht) |
| `AI_ALLOWED_USER_IDS` | – | Kommaliste erlaubter Nutzer |
| `AI_OWNER_USER_IDS` | – | Kommaliste freigabeberechtigter Owner |
| `AI_ALLOWED_CHANNEL_IDS` | – | Kommaliste erlaubter Channels |
| `AI_PROTECTED_CHANNEL_IDS` | leer | Nie veränderbare Channels (Phase 3) |
| `AI_PROTECTED_ROLE_IDS` | leer | Nie veränderbare Rollen (Phase 3) |
| `AI_REQUIRE_MENTION` | `true` | Ohne Mention keine Weiterleitung |
| `AI_APPROVAL_TTL_SECONDS` | `300` | Lebensdauer einer Owner-Freigabe |
| `AI_REQUEST_CONTEXT_TTL_SECONDS` | `900` | Lebensdauer einer Request-ID |
| `AI_AUDIT_LOG_PATH` | `data/runtime/ai-audit.log` | Audit-Trail (JSONL) |
| `AI_DESTRUCTIVE_TOOLS_ENABLED` | `false` | Phase 4; ohne dieses Flag sind destruktive Tools nicht registrierbar |

Mit `AI_AGENT_ENABLED=true` schlägt der Start **hart fehl**, solange Guild, Socket-Secret
oder eine der drei Allowlists fehlt.

## Secret erzeugen

```sh
umask 077
openssl rand -hex 32 > /run/secrets/ai-socket-secret
```

## Sidecar starten — ohne Bot-Token

Der Sidecar darf die Environment des Hauptprozesses **nicht** erben. Als systemd-Unit:

```ini
[Service]
Environment=
Environment=AI_SOCKET_PATH=/srv/gpu-search/data/runtime/claude-channel.sock
Environment=AI_SOCKET_SECRET_FILE=/run/secrets/ai-socket-secret
ExecStart=/usr/bin/node /srv/gpu-search/tools/claude-gpu-search-channel/src/index.js
```

Das leere `Environment=` löscht zuvor gesetzte Variablen. Startet der Sidecar dennoch
mit `DISCORD_BOT_TOKEN` oder `DISCORD_TOKEN`, beendet er sich mit Exit-Code 1.

## Healthcheck

Der Sidecar kann `health` über den Socket abfragen. Antwort:

```json
{
  "discordReady": true,
  "sidecarConnected": true,
  "registeredTools": ["get_guild_info", "list_channels", "..."],
  "openContexts": 0
}
```

`list_tools` liefert denselben Katalog mit Risikoklasse, Freigabepflicht und
Argumentnamen. Der Sidecar bietet Claude genau diese Werkzeuge an.

## Discord-Rechte für die Read-Tools

Der Bot bekommt im Developer Portal nur die Rechte, die die registrierten Werkzeuge
wirklich brauchen. **Keine `Administrator`-Berechtigung.**

| Recht | Wofür |
|---|---|
| View Channels | `list_channels`, `view_channel_permissions`, `get_messages` |
| Read Message History | `get_messages` |
| View Audit Log | `get_audit_log` |
| Manage Webhooks | `list_webhooks` |
| Manage Server | `list_invites`, `list_automod_rules` |
| Ban Members | `list_bans` |

`Manage Webhooks`, `Manage Server` und `Ban Members` sind **schreibfähige** Discord-Rechte.
Der Prozess nutzt sie nur lesend — die Tool-Policy lässt nichts anderes zu —, aber das
Token könnte bei Kompromittierung mehr.

**Entschieden (3. September 2026): Der Bot hat diese Rechte bereits, alle vier Werkzeuge
bleiben registriert.** Der Verzicht auf `list_bans`, `list_invites`, `list_webhooks` und
`list_automod_rules` wäre die Alternative gewesen und ist bewusst nicht gewählt worden.

Das privilegierte Gateway-Intent `GUILD_MEMBERS` ist bereits aktiv (der Bot nutzt es für
Welcome-Nachrichten) und wird von `list_members`/`get_member` mitverwendet.

## Neustart und Recovery

- Offene Freigaben liegen nur im Speicher und sind nach einem Neustart ungültig.
- Request-Kontexte laufen nach `AI_REQUEST_CONTEXT_TTL_SECONDS` ab.
- Der Socket wird beim Start neu angelegt; eine verwaiste Socket-Datei wird entfernt.
- Fällt Claude oder der Sidecar aus, laufen Scanner, Valorant, Slash-Commands,
  Reactions und Reminder weiter. Agent-Anfragen werden mit
  „KI-Funktion derzeit nicht verfügbar.“ beantwortet, statt gepuffert zu werden.

## Logs

`AI_AUDIT_LOG_PATH` ist eine append-only JSONL-Datei ohne Secrets. Rotation über
`logrotate` (z. B. täglich, 14 Generationen); der Prozess hält keinen Dateihandle offen.

## Claude Code

- Betrieb ausschließlich über den Claude.ai-Abo-Login. **Kein Anthropic-API-Key** im Projekt.
- Berechtigungen aus `.claude/settings.example.json` übernehmen: Read-Tools erlaubt,
  alles andere `ask`, destruktive Werkzeuge `deny`.
