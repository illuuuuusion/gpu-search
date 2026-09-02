# Third Party Notices

Dieses Paket enthält **keine** Laufzeit-Abhängigkeiten. Es orientiert sich konzeptionell
an zwei fremden Projekten. Deren Code wird nicht zur Laufzeit geladen; übernommene
Konzepte und ggf. adaptierte Tool-Schemas sind hier nachzuweisen.

## Offizielles Claude-Code-Discord-Plugin

- Quelle: https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord
- Übernommen: Channel-Protokoll-Idee (stdio), Reply-/React-/Edit-Semantik, Permission-UX
- **Nicht** übernommen: der direkte Discord-Login des Plugins
- Gepinnter Commit: `TODO — vor produktiver Nutzung eintragen und Lizenzhinweis ergänzen`

## QuadsLab Discord MCP

- Quelle: https://github.com/HardHeadHackerHead/discord-mcp
- Übernommen: Tool-Namen und Argument-Schemas als Vorlage für `toolPolicy.ts`
- **Nicht** übernommen: eigener Discord-Client, `npx`-Laufzeitbezug, `Administrator`-Setup
- Gepinnter Commit: `TODO — vor produktiver Nutzung eintragen und Lizenzhinweis ergänzen`

Solange die Commits nicht gepinnt sind, darf keine der beiden Quellen zur Laufzeit
geladen werden. Das ist in Phase 1 auch technisch der Fall: es gibt keinerlei
Abhängigkeit auf eines der beiden Projekte.
