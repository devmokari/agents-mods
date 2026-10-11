# agents

A [Claude Code](https://claude.com/claude-code) mod that gives you a team of named agents, each with a photo, a role and its own chat, in an Agents pane beside your main conversation.

## Features

- **Agents inbox.** Type `/faces` to open it. Pick an agent, write a message, and Claude starts that agent; its answer lands in the agent's own chat.
- **Tile and fill.** In a narrow pane you get the agent list. Maximise it for the full chat, with the agent's name at the top and your team in a bar along the bottom.
- **Teams.** Agents are grouped by team. Use **+** to add agents and teams or change an agent's title, team and model. Use **⋯** on an agent to rename or delete it.
- **At a glance.** Each agent shows its photo, its last message and an unread count. A dot on the photo shows when it is working or waiting.
- **Teamwork.** Agents can message each other and update their own profile when you ask them to.
- **Light and dark themes.** Colours follow your Claude theme.

## Install

```bash
claude plugin marketplace add devmokari/agents-mods
claude plugin install agents@mods
```

Then quit and reopen Claude, and type `/faces`.

To update later:

```bash
claude plugin marketplace update mods
claude plugin update agents@mods
```

Restart Claude after updating.

## How it works

The mod is built on the Claude Code mods API. One hooks module draws the Agents pane and keeps your roster and chats in the plugin's local store. Messages go out as prompts that ask Claude to start each agent as a named subagent. The agent then calls the mod's tools to read its briefing, message teammates or update its profile, and its reply is routed back to its chat. Small surface modules handle the desktop message box and row selection.

Your agents and chats stay on your machine; nothing is sent anywhere except through Claude itself.

**Known limits.** On desktop, clicking an agent's photo doesn't select it; click its name instead. Fixed headers and borders are limited to what the host can draw.

## Development

```bash
claude plugin validate .
claude plugin test .
```

## Licence

MIT, see [LICENSE](LICENSE).
