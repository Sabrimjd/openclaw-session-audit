# Discord Audit Stream

A daemon that monitors OpenClaw session files and sends **all events** to a Discord channel via webhook.

## Features

- **All event types tracked** - Not just tool calls
- **Real-time monitoring** - Watches session files for new events
- **Batched messages** - Groups events within 8-second windows
- **Rich formatting** - Icons, timestamps (with ms), durations, diff stats
- **Project detection** - Shows project name from session cwd
- **Model tracking** - Displays which LLM model is being used
- **Session info** - Full session key, type, tokens, provider, surface
- **Thinking level** - Shows current thinking level in header
- **Webhook + fallback** - Primary Discord webhook with openclaw CLI fallback

## Event Types Tracked

| Event | Icon | Description |
|-------|------|-------------|
| **Tool Calls** | ⚡✏️📝📖... | All tool invocations with args |
| **Tool Results** | ❌ | Error status, diff stats |
| **User Messages** | 💬 | Sender + truncated preview |
| **Response Complete** | ✅ | Token count on completion |
| **Thinking** | 💭 | Truncated reasoning preview |
| **Prompt Errors** | ❌ | Errors (aborted, timeout, etc.) |
| **Model Changes** | 🔄 | Model switches mid-session |
| **Context Compaction** | 🗜️ | Token count + truncated summary |
| **Images** | 🖼️ | MIME type + source metadata |
| **Thinking Level** | 🧠 | off/low/medium/high |

## Message Format

```
🦞[clawd] (glm-4.7) [subagent] 👤agent:main:discord:channel:1474452532959907944 | 📁/home/sab/clawd | 📊62k/262k (24%) | 🧠high | 🖥️discord | 🔌discord | ⏰21:28 | 🔗14744525

21:32:10.54 💬 Loky: "Hello pop a GLM-5 subagent and do a check..."
21:32:10.55 💭 Thinking: "Let me analyze the request and spawn a subagent..."
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
🦞[clawd] (glm-4.7) [subagent] 👤47e590 | 📁/home/sab/clawd | 📊262k | 🖥️discord | 🔌heartbeat | ⏰21:30 | 🔗93444522

16:35:42.15 ⚡ exec (78ms):
```bash
docker compose up --build -d
```

16:35:43.22 ✏️ edit (27ms) (+3/-2 lines, +156/-89 chars): `/home/sab/projects/app/src/page.tsx`

16:35:44.01 📖 read (15ms): `/home/sab/projects/app/config.ts`
```

## Header Format (Single Line)

```
🦞[project-name] (model-id) [subagent] [thread:N] 👤key | 📁cwd | 📊used/total (pct) | 🧠level | 🖥️surface | 🔌provider | ⏰time | 🔗groupId
│    │              │           │          │        │        │            │          │           │          │
│    │              │           │          │        │            │          │           │          └── Group ID (for channels)
│    │              │           │          │        │            │          │           └── Last updated time
│    │              │           │          │        │            │          └── Provider (heartbeat, discord, etc)
│    │              │           │          │        │            └── Surface (webchat, discord, telegram)
│    │              │           │          │        └── Token usage: 62k/262k (24%)
│    │              │           │          └── Thread number (if thread session)
│    │              │           └── Optional: appears for subagents
│    │              └── LLM model being used
│    └── Project folder name
└── Agent emoji (🦞 for clawd, 🤖 default)
```

## Session Types

| Type | Icon | Key Format |
|------|------|------------|
| Direct | 👤 | `agent:main:main` |
| Channel | 👥 | `agent:main:discord:channel:123...` |
| Thread | 👤 + `[thread:N]` | `agent:main:main:thread:613` |
| Telegram | 👥 | `agent:main:telegram:group:-123` |
| Subagent | `[subagent]` | `agent:main:subagent:abc...` |

## Tool Icons

| Icon | Tool |
|------|------|
| ⚡ | exec |
| ✏️ | edit |
| 📝 | write |
| 📖 | read |
| 🔍 | glob, grep |
| 🌐 | webfetch |
| ⚙️ | process |
| 🚀 | sessions_spawn |
| 📤 | delegate_task |
| 🤖 | call_agent |

## Agent Emojis

Configure in `AGENT_EMOJIS` constant:
- `clawd` → 🦞 (lobster)
- Default → 🤖 (robot)

## Configuration

| Constant | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_URL` | (hardcoded) | Discord webhook URL |
| `AUDIT_CHANNEL` | env var | Fallback channel ID |
| `RATE_LIMIT_MS` | 2000 | Min time between messages |
| `BATCH_WINDOW_MS` | 8000 | Window to batch calls |
| `MAX_BATCH_SIZE` | 15 | Auto-flush at N calls |
| `MAX_MESSAGE_LENGTH` | 1700 | Discord message limit |
| `COLLAPSE_THRESHOLD` | 200 | Chars before spoiler wrap |

## Files

```
discord-audit-stream/
├── daemon.ts          # Main daemon code
├── handler.ts         # Hook handler (starts daemon)
├── README.md          # This file
└── state/
    ├── state.json     # Offsets & seen IDs
    └── daemon.pid     # Current daemon PID
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
3. **Track** - Records tool calls with timestamps
4. **Batch** - Waits 8s of inactivity before sending
5. **Send** - POSTs to Discord webhook

## Adding New Agent Emojis

Edit `AGENT_EMOJIS` in `daemon.ts`:

```typescript
const AGENT_EMOJIS: Record<string, string> = {
  clawd: "🦞",
  myagent: "🐉",
  worker: "🔨",
};
```

## Filtering Tools

Uncomment line ~509 to only track destructive tools:

```typescript
if (!["exec", "edit", "write"].includes(name)) continue;
```

## Restarting

```bash
kill $(cat state/daemon.pid)
node daemon.ts &
```

## Logs

Daemon outputs to stdout:
```
[discord-audit-stream] Daemon running, PID: 12345
[discord-audit-stream] Rate limited, retry after: 5
[discord-audit-stream] Webhook error: ...
```
