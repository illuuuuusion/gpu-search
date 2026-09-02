# claude-gpu-search-channel

Lokaler Claude-Code-Channel-Sidecar für `gpu-search`.

## Was dieser Prozess ist

- Er spricht das Channel-Protokoll über **stdio** mit einer laufenden Claude-Code-Session.
- Er spricht über einen **Unix-Domain-Socket** mit dem `gpu-search`-Hauptprozess.
- Er reicht ausschließlich Toolname, fachliche Argumente und die vom Hauptprozess
  ausgestellte `requestId` weiter.
- Den Katalog der Admin-Werkzeuge holt er beim Verbinden per `list_tools` vom
  Hauptprozess und bietet Claude genau diese an — je Werkzeug unter eigenem Namen,
  damit die Permissions in `.claude/settings.json` pro Tool greifen. Eine eigene
  Toolliste führt er bewusst nicht.

## Was dieser Prozess ausdrücklich nicht ist

- **Kein Discord-Client.** Er importiert `discord.js` nicht und hat keine Abhängigkeiten.
- **Kein Token-Besitzer.** Startet er mit einer vererbten `DISCORD_BOT_TOKEN`- oder
  `DISCORD_TOKEN`-Variable, bricht er mit Exit-Code 1 ab (`assertNoDiscordCredentials`).
- **Kein Netzwerk-Listener.** Es wird kein Port geöffnet.
- **Keine Autorisierungsinstanz.** Allowlists, Tool-Policy und Freigaben entscheidet
  allein `gpu-search`.

## Konfiguration

| Variable | Bedeutung |
|---|---|
| `AI_SOCKET_PATH` | Pfad des Unix-Sockets, den `gpu-search` bereitstellt |
| `AI_SOCKET_SECRET_FILE` | Datei mit dem gemeinsamen lokalen Secret (Pflicht) |

Beim Start als Service ist eine **explizite Minimal-Environment** zu setzen, damit der
Sidecar den Bot-Token nicht erbt — siehe `docs/ai-agent/operations.md`.

## Start

```sh
env -i PATH=/usr/bin:/bin NODE_ENV=production \
  AI_SOCKET_PATH=/srv/gpu-search/data/runtime/claude-channel.sock \
  AI_SOCKET_SECRET_FILE=/run/secrets/ai-socket-secret \
  node tools/claude-gpu-search-channel/src/index.js
```

## Tests

```sh
npm test --workspace claude-gpu-search-channel
```

## Upstream-Pins

Der Sidecar orientiert sich am offiziellen Claude-Code-Discord-Plugin (Channel-Protokoll,
Nachrichtendarstellung, Reply-Semantik, Permission-UX) und an QuadsLab (Tool-Schemas).
Beide Quellen sind **vor der produktiven Nutzung auf einen konkreten Commit zu pinnen**;
die Pins stehen in `THIRD_PARTY_NOTICES.md` und sind dort noch offen markiert.
Insbesondere die Frame-Namen in `src/channel/index.js` sind gegen den gepinnten
Plugin-Stand abzugleichen.
