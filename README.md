# OpenClaw Discord Audit Stream

[![npm version](https://badge.fury.io/js/openclaw-discord-audit-stream.svg)](https://badge.fury.io/js/openclaw-discord-audit-stream)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/Sabrimjd/discord-audit-stream.svg)](https://github.com/Sabrimjd/discord-audit-stream/releases)

![Discord Audit Stream Example](pic/screenshot.png)

Monitor all OpenClaw session events and stream them to a Discord channel in real-time.

## Installation

```bash
openclaw plugins install openclaw-discord-audit-stream
```

## Configuration

Configure in your OpenClaw config (`~/.openclaw/openclaw.json`):

### Option A: Fallback Mode (uses OpenClaw's Discord bot)

No webhook setup needed - uses your existing OpenClaw Discord integration:

```json
{
  "plugins": {
    "entries": {
      "openclaw-discord-audit-stream": {
        "enabled": true,
        "config": {
          "sendMethod": "fallback",
          "fallbackChannelId": "YOUR_DISCORD_CHANNEL_ID"
        }
      }
    }
  }
}
```

### Option B: Webhook Mode (faster, recommended)

```json
{
  "plugins": {
    "entries": {
      "openclaw-discord-audit-stream": {
        "enabled": true,
        "config": {
          "sendMethod": "webhook",
          "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN"
        }
      }
    }
  }
}
```

### Option C: Auto Mode (tries webhook, falls back to CLI)

```json
{
  "plugins": {
    "entries": {
      "openclaw-discord-audit-stream": {
        "enabled": true,
        "config": {
          "sendMethod": "auto",
          "webhookUrl": "https://discord.com/api/webhooks/...",
          "fallbackChannelId": "YOUR_CHANNEL_ID"
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Required | Description | Default |
|--------|----------|-------------|---------|
| `webhookUrl` | No* | Discord webhook URL | - |
| `fallbackChannelId` | No* | Channel ID for openclaw CLI fallback | - |
| `sendMethod` | No | `"webhook"`, `"fallback"`, or `"auto"` | `"auto"` |
| `rateLimitMs` | No | Rate limit between messages (ms) | 2000 |
| `batchWindowMs` | No | Batch window for grouping events (ms) | 8000 |
| `maxBatchSize` | No | Max events per batch | 15 |
| `agentEmojis` | No | Emoji mappings for agents | `{ clawd: "🦞" }` |

*Either `webhookUrl` or `fallbackChannelId` must be provided depending on `sendMethod`.

## Message Format

Each audit message contains a **header** with session metadata followed by **events**:

```
🤖[sab] (qwen3-coder-plus) 👥agent:main:discord:channel:1474542... | 📁/home/sab | 📊22k/262k (8%) | 🧠off | 🖥️discord | 🔌discord | ⏰13:22 | 🔗14745425
13:49:41.24 💬 Loky:
I created this how can i advertise it to share it to the open source community ?
13:49:51.37 ✅ Response completed (22,365 tokens): " To advertise your OpenClaw project..."
```

### Header Fields

| Field | Example | Description |
|-------|---------|-------------|
| `🤖[name]` | `🤖[sab]` | Agent/workspace name with emoji |
| `(model)` | `(qwen3-coder-plus)` | Current model in use |
| `👥/👤` | `👥agent:main:discord:...` | Chat type (group/direct) + session key |
| `[subagent]` | `[subagent]` | Tag if this is a subagent session |
| `[thread:N]` | `[thread:567]` | Thread number if in a thread |
| `📁` | `📁/home/sab` | Working directory |
| `📊` | `📊22k/262k (8%)` | Token usage (used/context window %) |
| `🧠` | `🧠off` | Thinking level (off/low/medium/high) |
| `🖥️` | `🖥️discord` | Surface (discord, telegram, cli, etc.) |
| `🔌` | `🔌discord` | Provider/channel type |
| `⏰` | `⏰13:22` | Session start time |
| `🔗` | `🔗14745425` | Group/channel ID (shortened) |

### Event Format

Each event is formatted as:
```
HH:mm:ss.ms ICON Event details
```

## Event Icons

| Icon | Event | Icon | Event |
|------|-------|------|-------|
| ⚡ | exec | ✏️ | edit |
| 📝 | write | 📖 | read |
| 🔍 | grep/glob | 🌐 | webfetch |
| 💬 | User message | ✅ | Response completed |
| 💭 | Thinking | ❌ | Error |
| 🔄 | Model change | 🗜️ | Context compaction |
| 🖼️ | Image | 🧠 | Thinking level |
| 🚀 | sessions_spawn | 📋 | sessions_list |
| 📤 | delegate_task | 💻 | bash/process |

## Send Methods

### Webhook (Recommended)
- ✅ Faster - direct HTTP POST
- ✅ More reliable - no external dependency
- ✅ Works without openclaw CLI installed
- ✅ Lower resource usage

### Fallback (OpenClaw CLI)
- ✅ No webhook setup needed
- ✅ Can send to any channel you have access to
- ❌ Slower - spawns a subprocess
- ❌ Higher resource usage

### Auto Mode (Default)
Tries webhook first, falls back to openclaw CLI if webhook fails.

## Agent Skill

Share `skills/discord-audit-stream/SKILL.md` with your AI agent for automated installation and configuration.

## Features

### Event Tracking
- **Tool Calls** - exec, edit, write, read, etc. with durations
- **User Messages** - Sender name + preview
- **Response Completion** - Token counts
- **Thinking/Reasoning** - Agent thoughts
- **Errors** - Timeouts, API errors, aborts
- **Model Changes** - Mid-session switches
- **Context Compaction** - Token summaries
- **Images** - MIME type metadata

### Smart Formatting
- 40+ event-specific icons
- Millisecond timestamps
- Diff statistics (lines/chars added/removed)
- Session metadata (project, model, tokens)

### Performance
- Smart batching (groups events in time windows)
- Rate limiting (respects Discord limits)
- Handles large files (up to 10MB)
- State persistence across restarts
- **Skip history** - New sessions start at current position (no backfill)

## Troubleshooting

### No messages appearing
1. Verify config in `~/.openclaw/openclaw.json`
2. Restart gateway: `openclaw gateway restart`
3. Check daemon: `ps aux | grep daemon.ts`
4. Check logs: `journalctl --user -u openclaw-gateway.service -f`

### Rate limited
- Increase `rateLimitMs` (default: 2000ms)
- Discord limit: 5 requests per 2 seconds

### Uninstall
```bash
openclaw plugins uninstall openclaw-discord-audit-stream
```

## How It Works

1. **Watch** - Monitors OpenClaw session files via `fs.watch`
2. **Parse** - Reads new JSON lines from current position
3. **Track** - Records events with timestamps
4. **Batch** - Groups events within time window
5. **Send** - POSTs to Discord webhook or via OpenClaw CLI

## License

MIT License - See [LICENSE](LICENSE)

## Support

- **GitHub**: https://github.com/Sabrimjd/discord-audit-stream
- **npm**: https://www.npmjs.com/package/openclaw-discord-audit-stream
- **Issues**: https://github.com/Sabrimjd/discord-audit-stream/issues
