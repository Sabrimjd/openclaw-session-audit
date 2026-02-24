# Open Issues - openclaw-session-audit

## Priority: High

### Issue 1: Missing Header Fields

**Status**: Partially Fixed  
**File**: `src/daemon.ts`

**Problem**: Header is missing several fields that should be displayed:
- `👥` with session key (e.g., `agent:main:discord:channel:1474542...`)
- `🖥️` surface (e.g., `discord`)
- `⏰` session start time
- `🔗` group/channel ID (shortened)

**Current Output**:
```
🤖[sab] (qwen3-coder-plus) 31b2d9d3 | 📁/home/sab | 🔌bailian
```

**Expected Output**:
```
🤖[sab] (qwen3-coder-plus) 👥agent:main:discord:channel:1474542... | 📁/home/sab | 📊0k/29k (11%) | 🧠off | 🖥️discord | 🔌discord | ⏰13:22 | 🔗14745425
```

**Root Cause**: The `loadSessionsJson()` correctly loads metadata, but `scanAllFiles()` may be overwriting it when processing files. The `sessionKey` in `scanAllFiles()` uses `getBaseSessionId()` now, but there might be timing issues.

**Debug Steps**:
1. Add logging to see what metadata exists after `loadSessionsJson()`:
   ```javascript
   console.log('[session-audit] After loadSessionsJson:', sessionMetadata.get('31b2d9d3-156c-475c-a711-41c449c83e1f'));
   ```
2. Add logging after `scanAllFiles()`:
   ```javascript
   console.log('[session-audit] After scanAllFiles:', sessionMetadata.get('31b2d9d3-156c-475c-a711-41c449c83e1f'));
   ```

---

### Issue 2: Token Display Shows `0k/Xk`

**Status**: Open  
**File**: `src/daemon.ts`

**Problem**: `usedTokens` shows as 0 because:
1. We skip history (start at file end)
2. `usedTokens` is only populated when parsing message events
3. On new sessions or after restart, we haven't seen any messages yet

**Current Output**:
```
📊0k/29k (11%)
```

**Expected Output**:
```
📊29k/262k (11%)
```

**Root Cause**: 
- `contextTokens` comes from `sessions.json` (262144)
- `usedTokens` comes from parsing `message.usage.totalTokens` in .jsonl files
- When skipping history, we never parse old messages to get `usedTokens`

**Possible Fixes**:
1. **Option A**: Always read last N lines of session file to get latest `usedTokens`
2. **Option B**: Store `usedTokens` in state.json and persist across restarts
3. **Option C**: Get `usedTokens` from `sessions.json` if available

**Investigation Needed**:
- Check if `sessions.json` has `usedTokens` or similar field
- Check if we can efficiently read last few lines of large files

---

### Issue 3: Edit Diff Stats Not Showing

**Status**: Open  
**File**: `src/daemon.ts`

**Problem**: Edits should show `(+N/-M lines)` but don't appear.

**Current Output**:
```
20:08:02.467 ✏️ edit: jokes_poems.md
```

**Expected Output**:
```
20:08:02.467 ✏️ edit (+4/-2 lines): jokes_poems.md
```

**Root Cause**:
The diff stats come from `message.details.diff` in the toolResult. Looking at session file:
```json
{"type":"message","id":"...","message":{"role":"toolResult","toolCallId":"call_...","toolName":"edit","details":{"diff":"...","status":"completed"}}}
```

The `diff` field contains the actual diff text. Need to parse it to count +/- lines.

**Code Location**: `formatEvent()` function, case "toolCall":
```javascript
if (name === "edit" || name === "write") {
  const summary = path || "(unknown)";
  let diffStr = "";
  if (diffStats) {
    diffStr = ` (+${diffStats.added}/-${diffStats.removed} lines, +${diffStats.addedChars}/-${diffStats.removedChars} chars)`;
  }
  return `${time} ${errorPrefix}${icon} ${name}${durationStr}${diffStr}: \`${summary}\``;
}
```

**Code Location**: Tool result handling in `tailFile()`:
```javascript
if (message.role === "toolResult") {
  // ... find pending tool call
  // Parse diff stats for edits
  if (message.details?.diff && (data.name === "edit" || data.name === "write")) {
    data.diffStats = parseDiffStats(message.details.diff);
  }
}
```

**Investigation Needed**:
1. Is `parseDiffStats()` being called?
2. Is `message.details.diff` present in the toolResult?
3. Is the tool call event being found in `pendingEvents`?

**Debug Steps**:
1. Log when toolResult is processed:
   ```javascript
   if (message.role === "toolResult" && message.toolName === "edit") {
     console.log('[session-audit] edit result:', message.details);
   }
   ```

---

## Priority: Medium

### Issue 4: Write Should Show Bytes Written

**Status**: Enhancement  
**File**: `src/daemon.ts`

**Problem**: Write operations should show bytes written.

**Current Output**:
```
📝 write: jokes_poems.md
```

**Expected Output**:
```
📝 write (972 bytes): jokes_poems.md
```

**Root Cause**: The write result contains text like `"Successfully wrote 972 bytes to /home/sab/poem2.md"` but we don't parse it.

**Fix**: Parse the result text to extract bytes, or check if `message.details` has a bytes field.

---

## Debugging Tips

### Enable Daemon Logging
The daemon runs with `stdio: "ignore"`. To see logs, modify `index.ts`:
```javascript
const child = spawn("node", [join(__dirname, "src", "daemon.ts")], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],  // Capture stdout/stderr
  cwd: __dirname,
  env,
});
child.stdout.on("data", (data) => console.log(`[daemon] ${data}`));
child.stderr.on("data", (data) => console.error(`[daemon] ${data}`));
```

### Check Session Metadata
```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.env.HOME + '/.openclaw/agents/main/sessions/sessions.json', 'utf8'));
for (const [key, value] of Object.entries(data)) {
  if (key.includes('1464758843798982696')) {
    console.log('Key:', key);
    console.log('Metadata:', JSON.stringify(value, null, 2));
  }
}
"
```

### Check ToolResult Format
```bash
grep '"role":"toolResult"' ~/.openclaw/agents/main/sessions/*.jsonl | tail -1 | jq '.message'
```

---

## Test Session File

Session ID: `31b2d9d3-156c-475c-a711-41c449c83e1f`  
Channel: `#ai` (Discord)  
Channel ID: `1464758843798982696`  
Key: `agent:main:discord:channel:1464758843798982696`

---

## Related Files

- `/home/sab/projects/CLAUDE.md` - Project management guide
- `/home/sab/.openclaw/openclaw.json` - OpenClaw config
- `/home/sab/.openclaw/extensions/openclaw-session-audit/` - Installed plugin
