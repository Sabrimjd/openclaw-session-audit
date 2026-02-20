---
name: discord-audit-stream
description: "Stream tool calls from sessions to Discord audit channel"
metadata:
  openclaw:
    emoji: "🧪"
    events: ["gateway:startup"]
---
# Discord Audit Stream

Background daemon that tails session files and sends tool call summaries to Discord.

## Features

- Streaming I/O (never loads full files into memory)
- Persistent state (survives restarts)
- Rate limited (5s min, 12/min max)
- 3-second batching

## Configuration

Set environment variables:
- `DISCORD_AUDIT_CHANNEL_ID`: Target Discord channel (default: 1474043146705830112)
- `OPENCLAW_BIN`: Path to openclaw binary (default: "openclaw")
