---
name: openclaw-session-audit
description: Install and configure the Session Audit plugin for OpenClaw. Use this skill to set up real-time session event streaming to any channel (Discord, Telegram, Slack, etc.).
---

# Session Audit Plugin Installation

Stream all OpenClaw session events to any channel in real-time.

> npm: `openclaw-session-audit`
> GitHub: https://github.com/Sabrimjd/openclaw-session-audit

---

## When to Use

Use this skill when you need to:
- **Install the Session Audit plugin** for OpenClaw
- **Configure event streaming** to Discord, Telegram, Slack, or other channels
- **Set up multi-channel audit logging**

---

## Prerequisites

- OpenClaw installed and running
- Target channel ID (Discord channel, Telegram group, Slack channel, etc.)

---

## Installation

### 1. Install the Plugin

```bash
openclaw plugins install openclaw-session-audit
```

### 2. Configure the Plugin

Add to `~/.openclaw/openclaw.json` under `plugins.entries`:

#### Discord

```json
{
  "plugins": {
    "entries": {
      "openclaw-session-audit": {
        "enabled": true,
        "config": {
          "channel": "discord",
          "targetId": "YOUR_DISCORD_CHANNEL_ID"
        }
      }
    }
  }
}
```

#### Telegram

```json
{
  "plugins": {
    "entries": {
      "openclaw-session-audit": {
        "enabled": true,
        "config": {
          "channel": "telegram",
          "targetId": "-1001234567890"
        }
      }
    }
  }
}
```

#### Slack

```json
{
  "plugins": {
    "entries": {
      "openclaw-session-audit": {
        "enabled": true,
        "config": {
          "channel": "slack",
          "targetId": "C12345678"
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
| `channel` | string | - | OpenClaw channel name (discord, telegram, slack, etc.) |
| `targetId` | string | - | Target ID (channel, group, or user ID) |
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
openclaw plugins uninstall openclaw-session-audit
```

---

## Migration from discord-audit-stream

1. Uninstall old:
   ```bash
   openclaw plugins uninstall openclaw-discord-audit-stream
   ```

2. Install new:
   ```bash
   openclaw plugins install openclaw-session-audit
   ```

3. Update config - change from webhook/fallback to channel/targetId format.
