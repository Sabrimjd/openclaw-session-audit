# Project Management Guide for AI Agents

This document provides context for AI agents working on projects maintained by Sabri MJD.

---

## Active Projects

### openclaw-session-audit

**NPM**: https://www.npmjs.com/package/openclaw-session-audit
**GitHub**: https://github.com/Sabrimjd/openclaw-session-audit
**Local Path**: `/home/sab/projects/openclaw-session-audit`

#### Description
OpenClaw plugin that monitors session files and streams events to any channel (Discord, Telegram, Slack, etc.).

#### Key Files
| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry point - registers service, spawns daemon, kills old daemons on restart |
| `src/index.ts` | Daemon entry point - loads config, starts file watcher |
| `src/daemon.ts` | Main daemon - watches session files, formats events, sends messages |
| `src/state.ts` | State management - offsets, seen IDs, PID file |
| `openclaw.plugin.json` | Plugin manifest with config schema |
| `package.json` | NPM package config |
| `skills/openclaw-session-audit/SKILL.md` | Agent skill for automated installation |

#### Installation
```bash
# From npm (recommended)
openclaw plugins install openclaw-session-audit@1.0.6

# From local
cp -r /home/sab/projects/openclaw-session-audit ~/.openclaw/extensions/openclaw-session-audit
```

#### Configuration (in `~/.openclaw/openclaw.json`)
```json
{
  "plugins": {
    "entries": {
      "openclaw-session-audit": {
        "enabled": true,
        "config": {
          "channel": "discord",
          "targetId": "1474043146705830112"
        }
      }
    }
  }
}
```

#### Publish Workflow
1. Make changes to code
2. Update version in both `package.json` and `openclaw.plugin.json`
3. Commit and push to GitHub:
   ```bash
   git add -A && git commit -m "fix: description"
   git push origin main
   ```
4. Create and push git tag:
   ```bash
   git tag -a v1.0.X -m "v1.0.X - Description"
   git push origin v1.0.X
   ```
5. Create GitHub release (triggers npm publish via trusted publisher):
   ```bash
   gh release create v1.0.X --repo Sabrimjd/openclaw-session-audit --title "v1.0.X" --notes "Description"
   ```
6. Wait ~30s for npm publish, then verify: `npm view openclaw-session-audit version`
7. Or publish manually: `npm publish --access public`

#### Update & Restart Workflow
After publishing a new version, update the installed plugin:
```bash
# 1. Remove old plugin and install new version
rm -rf ~/.openclaw/extensions/openclaw-session-audit
openclaw plugins install openclaw-session-audit@1.0.X

# 2. Kill any orphaned daemon processes (v1.0.6+ handles this automatically)
pkill -f "session-audit"

# 3. Restart gateway
systemctl --user restart openclaw-gateway.service

# 4. Verify only ONE daemon tree is running (5 processes = 1 tree)
ps aux | grep "session-audit" | grep -v grep
```

#### Key Functions
In `index.ts`:
- `killAllDaemons()` - Kills all existing daemon processes using pkill
- `startDaemon()` - Spawns new daemon after killing old ones
- `stopDaemon()` - Stops all daemons and cleans up PID file

In `src/daemon.ts`:
- `loadSessionsJson()` - Loads rich metadata from sessions.json (chatType, provider, surface, groupId)
- `scanAllFiles()` - Scans all .jsonl files to build metadata
- `tailFile()` - Watches a session file for new events
- `formatEvent()` - Formats events for Discord display
- `buildMessage()` - Builds the full message with header + events
- `getProjectInfo()` - Extracts session metadata for header

In `src/state.ts`:
- `checkSingleInstance()` - Safety check, cleans up stale PID file
- `writePidFile()` - Writes current PID to state file
- `loadState()` / `saveState()` - Persist offsets and seen IDs

#### Important Patterns
- **Session Key**: Always use `getBaseSessionId(filename)` to get the UUID-only key for metadata lookups
- **Skip History**: New files read first line for metadata, then skip to end to avoid spamming Discord
- **Metadata Sources**: `loadSessionsJson()` → `scanAllFiles()` → `tailFile()` first line

---

### discord-audit-stream (Deprecated)

**GitHub**: https://github.com/Sabrimjd/discord-audit-stream  
**Status**: Superseded by `openclaw-session-audit`

The old package used webhook + fallback mode. New package uses channel/targetId for multi-channel support.

---

## Common Tasks

### Multiple Daemon Instances Bug (Fixed in v1.0.6)

**Problem**: When OpenClaw restarts, multiple daemon instances could spawn, causing duplicate messages in Discord.

**Solution**: `index.ts` now uses `pkill -f "tsx.*session-audit.*index.ts"` to kill ALL existing daemon processes before starting a new one.

**Key changes**:
- `killAllDaemons()` function in `index.ts` kills all matching processes
- `startDaemon()` calls `killAllDaemons()` before spawning
- `stopDaemon()` uses `killAllDaemons()` for consistency
- `checkSingleInstance()` in `state.ts` simplified to just clean up PID file

**Verification**:
```bash
# Should see exactly 5 processes (1 daemon tree)
ps aux | grep "session-audit" | grep -v grep | wc -l
```

### Debugging the Daemon
```bash
# Check if daemon is running
ps aux | grep daemon.ts

# Check logs
journalctl --user -u openclaw-gateway.service -f

# Clear state and restart
rm -rf ~/.openclaw/extensions/openclaw-session-audit/state
systemctl --user restart openclaw-gateway.service
```

### Testing Plugin Changes Locally
```bash
# Option 1: Copy individual files
cp /home/sab/projects/openclaw-session-audit/src/daemon.ts ~/.openclaw/extensions/openclaw-session-audit/src/

# Option 2: Copy entire plugin
rm -rf ~/.openclaw/extensions/openclaw-session-audit
cp -r /home/sab/projects/openclaw-session-audit ~/.openclaw/extensions/openclaw-session-audit

# Clear state and restart
rm -rf ~/.openclaw/extensions/openclaw-session-audit/state
pkill -f "session-audit"
systemctl --user restart openclaw-gateway.service

# Verify single daemon
ps aux | grep "session-audit" | grep -v grep
```

---

## OpenClaw Plugin Development

### Config Flow
1. User adds config to `~/.openclaw/openclaw.json` under `plugins.entries.<plugin-id>.config`
2. OpenClaw loads plugin and calls `register(api)`
3. Plugin's `index.ts` reads config via `api.config.plugins.entries.<plugin-id>.config`
4. Pass config to daemon via environment variables
5. Daemon reads env vars in `loadConfig()`

### State Management
- State file: `~/.openclaw/extensions/<plugin>/state/state.json`
- Contains: `offsets` (file positions), `seenIds` (deduplication)
- Save periodically, load on startup

### Skip History Pattern
For new files (no offset stored):
1. Read first line(s) for metadata (session cwd, model-snapshot)
2. Set offset to file size (skip to end)
3. Only process new lines going forward

---

## Environment Details

- **Platform**: Linux
- **Node**: v18+
- **OpenClaw Config**: `~/.openclaw/openclaw.json`
- **Sessions Directory**: `~/.openclaw/agents/main/sessions/`
- **Sessions Metadata**: `~/.openclaw/agents/main/sessions/sessions.json`
- **Extensions Directory**: `~/.openclaw/extensions/`

---

## Git Configuration

```bash
git config user.email "contact@sabrimjahed.com"
git config user.name "Sabri MJD"
```

---

## npm Publishing

### Trusted Publisher (Recommended)
GitHub Actions workflow uses npm trusted publisher. Just create a GitHub release.

### Manual Publishing
```bash
npm publish --access public
# May require OTP if 2FA enabled
```

---

## Useful Commands

```bash
# List active OpenClaw sessions
openclaw sessions --active 120

# Check plugin status
openclaw plugins list

# Send test message
openclaw message send --channel discord --target CHANNEL_ID --message "Test"

# Gateway logs
journalctl --user -u openclaw-gateway.service -f
```
