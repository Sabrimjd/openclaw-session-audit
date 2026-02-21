---
name: discord-audit-stream
description: Install and configure the Discord Audit Stream plugin for OpenClaw. Use this skill to set up real-time session event streaming to a Discord channel.
---

# Discord Audit Stream Plugin Installation

Stream all OpenClaw session events to a Discord channel in real-time.

> npm: `openclaw-discord-audit-stream`
> GitHub: https://github.com/Sabrimjd/discord-audit-stream

---

## When to Use

Use this skill when you need to:
- **Install the Discord Audit Stream plugin** for OpenClaw
- **Configure event streaming** to a Discord channel
- **Set up webhook or fallback mode** for message delivery

---

## Prerequisites

- OpenClaw installed and running
- Discord channel ID (for fallback mode)
- Optional: Discord webhook URL (for webhook mode - faster)

---

## Installation

### 1. Install the Plugin

```bash
openclaw plugins install openclaw-discord-audit-stream
```

### 2. Configure the Plugin

Add to `~/.openclaw/openclaw.json` under `plugins.entries`:

#### Option A: Fallback Mode (uses OpenClaw's Discord bot)

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

#### Option B: Webhook Mode (faster, recommended)

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

#### Option C: Auto Mode (tries webhook, falls back to CLI)

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

### 3. Restart the Gateway

```bash
openclaw gateway restart
```

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sendMethod` | string | `"auto"` | `webhook`, `fallback`, or `auto` |
| `webhookUrl` | string | - | Discord webhook URL |
| `fallbackChannelId` | string | - | Discord channel ID for fallback mode |
| `rateLimitMs` | number | 2000 | Rate limit between messages (ms) |
| `batchWindowMs` | number | 8000 | Batch window for grouping events (ms) |
| `maxBatchSize` | number | 15 | Max events per batch |
| `agentEmojis` | object | `{ clawd: "🦞" }` | Emoji mappings for agents |

---

## Event Icons

| Icon | Event | Icon | Event |
|------|-------|------|-------|
| ⚡ | exec | ✏️ | edit |
| 📝 | write | 📖 | read |
| 🔍 | grep/glob | 🌐 | webfetch |
| 💬 | User message | ✅ | Response completed |
| 💭 | Thinking | ❌ | Error |
| 🔄 | Model change | 🗜️ | Context compaction |

---

## Troubleshooting

### Plugin not loading

```bash
openclaw plugins list
openclaw plugins doctor
```

### No messages appearing

1. Check daemon is running:
   ```bash
   ps aux | grep daemon.ts
   ```

2. Check logs:
   ```bash
   journalctl --user -u openclaw-gateway.service -f
   ```

### Uninstall

```bash
openclaw plugins uninstall openclaw-discord-audit-stream
```

---

## Environment Variables (Alternative)

Config from `openclaw.json` is passed to the daemon. You can also override via env:

```bash
export DISCORD_AUDIT_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export DISCORD_AUDIT_CHANNEL_ID="123456789"
export DISCORD_AUDIT_SEND_METHOD="auto"
```

Priority: Environment variables > openclaw.json config > defaults
