---
name: discord-audit-stream
description: "Stream all session events to Discord via webhook"
metadata:
  openclaw:
    emoji: "🧪"
    events: ["gateway:startup"]
---
# Discord Audit Stream

Background daemon that monitors OpenClaw session files and sends all events to Discord.

## Events Tracked

- **Tool calls** - exec, edit, write, read, etc.
- **User messages** - with sender preview
- **Response completions** - token counts
- **Thinking/reasoning** - truncated previews
- **Errors** - aborted, timeout, API errors
- **Model changes** - mid-session switches
- **Context compaction** - token summaries
- **Images** - MIME type metadata
- **Thinking level** - off/low/medium/high

## Configuration

Edit `config.json` or use environment variables:

```json
{
  "webhookUrl": "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN",
  "fallbackChannelId": "YOUR_CHANNEL_ID",
  "rateLimitMs": 2000,
  "batchWindowMs": 8000,
  "agentEmojis": {
    "clawd": "🦞"
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_AUDIT_WEBHOOK_URL` | Discord webhook URL |
| `DISCORD_AUDIT_CHANNEL_ID` | Fallback channel ID |
| `DISCORD_AUDIT_RATE_LIMIT_MS` | Rate limit (default: 2000) |
| `DISCORD_AUDIT_BATCH_WINDOW_MS` | Batch window (default: 8000) |

## Files

```
discord-audit-stream/
├── openclaw.plugin.json   # Plugin manifest
├── index.ts               # Plugin entry point
├── hooks/                 # Hooks directory
│   ├── HOOK.md           # This file
│   └── handler.ts        # Hook handler
├── src/
│   └── daemon.ts         # Main daemon
├── config.json           # Configuration
└── state/                # Runtime state
    ├── state.json        # Offsets & seen IDs
    └── daemon.pid        # Process ID
```

## Installation

### Option 1: Install as Plugin (Recommended)

```bash
openclaw plugins install @openclaw/discord-audit-stream
```

### Option 2: Manual Install

```bash
cd ~/.openclaw/extensions
git clone https://github.com/Sabrimjd/discord-audit-stream.git
```

## Configuration

Configure in your OpenClaw config:

```json5
{
  plugins: {
    entries: {
      "discord-audit-stream": {
        enabled: true,
        config: {
          webhookUrl: "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN",
          fallbackChannelId: "YOUR_CHANNEL_ID",
          rateLimitMs: 2000,
          batchWindowMs: 8000,
          agentEmojis: { "clawd": "🦞" }
        }
      }
    }
  }
}
```

## Usage

The hook starts automatically when OpenClaw gateway starts.

Manual control:
```bash
# Start
node ~/.openclaw/extensions/discord-audit-stream/src/daemon.ts &

# Stop
kill $(cat ~/.openclaw/extensions/discord-audit-stream/state/daemon.pid)
```

## GitHub

https://github.com/Sabrimjd/discord-audit-stream
