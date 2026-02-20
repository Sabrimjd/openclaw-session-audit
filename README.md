# Discord Audit Stream

![Discord Audit Stream Example](pic/screenshot.webp)

A daemon that monitors OpenClaw session files and sends **all events** to a Discord channel via webhook.

## Features

### Comprehensive Event Tracking
- **Tool Calls** - All tool invocations with arguments and durations
- **User Messages** - Sender name + truncated preview
- **Response Completion** - Token count when agent finishes
- **Thinking/Reasoning** - Truncated preview of agent's thought process
- **Prompt Errors** - Aborted requests, timeouts, API errors
- **Model Changes** - Model switches mid-session
- **Context Compaction** - Token count + summary when context compressed
- **Images** - MIME type and source metadata
- **Thinking Level** - off/low/medium/high changes

### Rich Formatting
- **Icons** - 40+ tool icons, event-specific icons
- **Timestamps** - HH:MM:SS.ms precision
- **Durations** - Milliseconds, seconds, or minutes
- **Diff Stats** - Lines and characters added/removed
- **Session Metadata** - Project, model, tokens, provider, surface

### Smart Batching
- Groups events within configurable time windows
- Rate limiting to respect Discord limits
- Auto-flush when batch size exceeded

### Robustness
- Webhook primary with openclaw CLI fallback
- State persistence across restarts
- Handles large session files (up to 10MB)
- Thread and subagent support

## Advantages Over Built-in Logging

| Feature | Built-in Logger | Discord Audit Stream |
|---------|-----------------|---------------------|
| Remote visibility | ❌ Local files only | ✅ Real-time Discord |
| Rich formatting | ❌ Plain text | ✅ Emoji, timestamps, diffs |
| Team collaboration | ❌ Single machine | ✅ Shared Discord channel |
| Centralized monitoring | ❌ Scattered logs | ✅ One channel for all |
| Event types | ❌ Limited | ✅ 15+ event types |

## Installation

### Option 1: Install as Plugin (Recommended)

```bash
openclaw plugins install @openclaw/discord-audit-stream
```

Then configure in your OpenClaw config:

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
          agentEmojis: {
            "clawd": "🦞"
          }
        }
      }
    }
  }
}
```

### Option 2: Manual Install (Legacy)

```bash
cd ~/.openclaw/extensions
git clone https://github.com/Sabrimjd/discord-audit-stream.git
cd discord-audit-stream
```

Then enable in config:

```json5
{
  plugins: {
    entries: {
      "discord-audit-stream": { enabled: true }
    }
  }
}
```

## Configuration

### Quick Setup

1. **Copy example config:**
   ```bash
   cp .env.example .env
   ```

2. **Edit config.json** with your webhook URL:
   ```json
   {
     "webhookUrl": "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN",
     "fallbackChannelId": "YOUR_CHANNEL_ID",
     "agentEmojis": {
       "clawd": "🦞",
       "myagent": "🐉"
     }
   }
   ```

### Configuration Options

| Option | Config File | Env Variable | Default |
|--------|-------------|--------------|---------|
| Webhook URL | `webhookUrl` | `DISCORD_AUDIT_WEBHOOK_URL` | (required) |
| Fallback Channel | `fallbackChannelId` | `DISCORD_AUDIT_CHANNEL_ID` | - |
| Rate Limit (ms) | `rateLimitMs` | `DISCORD_AUDIT_RATE_LIMIT_MS` | 2000 |
| Batch Window (ms) | `batchWindowMs` | `DISCORD_AUDIT_BATCH_WINDOW_MS` | 8000 |
| Max Batch Size | `maxBatchSize` | - | 15 |
| Max Message Length | `maxMessageLength` | - | 1700 |
| Max File Size | `maxFileSize` | - | 10000000 |
| Agent Emojis | `agentEmojis` | - | { clawd: "🦞" } |

### Priority
**Environment variables > config.json > defaults**

## Running the Daemon

### Auto-start (Recommended)

The daemon starts automatically via OpenClaw's hook system on `gateway:startup`.

### Manual Start

```bash
cd ~/.openclaw/extensions/discord-audit-stream
node src/daemon.ts &
```

### Stop Daemon

```bash
kill $(cat state/daemon.pid)
```

### Restart Daemon

```bash
kill $(cat state/daemon.pid) 2>/dev/null; sleep 1; node src/daemon.ts &
```

## Message Format

### Example Output

```
🦞[clawd] (glm-4.7) [subagent] [thread:613] 👤agent:main:main:thread:613 | 📁/home/sab/clawd | 📊62k/262k (24%) | 🧠high | 🖥️discord | 🔌discord | ⏰21:28 | 🔗14744525

21:32:10.54 💬 Loky: "Hello pop a GLM-5 subagent and do a check..."
21:32:10.55 💭 Thinking: "Let me analyze the request and spawn..."
21:32:10.56 ⚡ exec (1.5s):
```bash
opencode run --model zai/glm-5 "Review the Discord hook..."
```
21:32:15.00 ✏️ edit (27ms) (+3/-2 lines, +156/-89 chars): `/home/sab/projects/app/src/page.tsx`
21:32:20.00 ✅ Response completed (234 tokens)
21:32:25.00 🖼️ Image received: image/png (base64:iVBORw0KGgo...)
21:32:30.00 ❌ Prompt error (glm-4.7): aborted
21:32:35.00 🔄 Model changed: qwen3-coder-next → glm-5
21:32:40.00 🗜️ Context compacted (258k tokens): Summary: Goal was to fix...
21:32:45.00 🧠 Thinking level: high
```

### Header Breakdown

| Position | Field | Example |
|----------|-------|---------|
| 1 | Agent emoji | 🦞 |
| 2 | Project name | [clawd] |
| 3 | Model ID | (glm-4.7) |
| 4 | Subagent tag | [subagent] |
| 5 | Thread tag | [thread:613] |
| 6 | Session type + key | 👤agent:main:main:thread:613 |
| 7 | Working directory | 📁/home/sab/clawd |
| 8 | Token usage | 📊62k/262k (24%) |
| 9 | Thinking level | 🧠high |
| 10 | Surface | 🖥️discord |
| 11 | Provider | 🔌discord |
| 12 | Last update | ⏰21:28 |
| 13 | Group ID | 🔗14744525 |

## Session Types

| Type | Icon | Key Format |
|------|------|------------|
| Direct | 👤 | `agent:main:main` |
| Channel | 👥 | `agent:main:discord:channel:123...` |
| Thread | 👤 + `[thread:N]` | `agent:main:main:thread:613` |
| Telegram | 👥 | `agent:main:telegram:group:-123` |
| Subagent | `[subagent]` | `agent:main:subagent:abc...` |

## Event Icons

| Icon | Event |
|------|-------|
| ⚡ | exec |
| ✏️ | edit |
| 📝 | write |
| 📖 | read |
| 🔍 | glob, grep |
| 🌐 | webfetch |
| ⚙️ | process |
| 🚀 | sessions_spawn |
| 📤 | delegate_task |
| 💬 | User message |
| ✅ | Response completed |
| 💭 | Thinking |
| ❌ | Prompt error |
| 🔄 | Model change |
| 🗜️ | Context compaction |
| 🖼️ | Image received |
| 🧠 | Thinking level |

## Files

```
discord-audit-stream/
├── openclaw.plugin.json   # Plugin manifest
├── index.ts               # Plugin entry point
├── package.json           # Package metadata
├── hooks/                 # Hooks directory
│   ├── HOOK.md           # Hook metadata for OpenClaw
│   └── handler.ts        # Hook handler (starts daemon)
├── src/
│   └── daemon.ts         # Main daemon code
├── config.json           # Configuration file
├── .env.example          # Environment variable template
├── .gitignore            # Git ignore rules
├── LICENSE               # MIT License
├── README.md             # This file
└── state/                # Runtime state
    ├── state.json        # Offsets & seen IDs
    └── daemon.pid        # Current daemon PID
```

## State Structure

```json
{
  "offsets": {
    "session-id.jsonl": 12345
  },
  "seenIds": ["call_abc123", "call_def456"],
  "lastSend": 1739987200000
}
```

## How It Works

1. **Watch** - Uses Node.js `fs.watch` to monitor session files
2. **Parse** - Reads new lines from offset, parses JSON
3. **Track** - Records all events with timestamps
4. **Batch** - Waits for configurable window before sending
5. **Send** - POSTs to Discord webhook (with fallback)

## Adding Agent Emojis

Edit `config.json`:

```json
{
  "agentEmojis": {
    "clawd": "🦞",
    "myagent": "🐉",
    "worker": "🔨",
    "planner": "📋"
  }
}
```

## Filtering Events

To filter specific event types, edit `daemon.ts` and modify the `tailFile` function:

```typescript
// Only track destructive tools
if (!["exec", "edit", "write"].includes(name)) continue;

// Only track user messages and completions
if (!["user_message", "assistant_complete"].includes(event.type)) continue;
```

## Troubleshooting

### No messages appearing
1. Check webhook URL is set in `config.json`
2. Verify daemon is running: `cat state/daemon.pid`
3. Check process: `ps aux | grep daemon.ts`

### Session file too large
- Increase `maxFileSize` in `config.json` (default: 10MB)

### Rate limited
- Increase `rateLimitMs` in `config.json`
- Check Discord webhook limits (5 requests/2 seconds)

## License

MIT License - See [LICENSE](LICENSE)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
