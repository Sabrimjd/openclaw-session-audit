import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SESSIONS_DIR = join(homedir(), ".openclaw", "agents", "main", "sessions");
const STATE_DIR = join(PROJECT_ROOT, "state");
const STATE_FILE = join(STATE_DIR, "state.json");
const PID_FILE = join(STATE_DIR, "daemon.pid");
const SESSIONS_JSON = join(SESSIONS_DIR, "sessions.json");

interface Config {
  channel: string;
  targetId: string;
  rateLimitMs: number;
  batchWindowMs: number;
  maxBatchSize: number;
  maxMessageLength: number;
  maxFileSize: number;
  maxSeenIds: number;
  agentEmojis: Record<string, string>;
}

function loadConfig(): Config {
  const defaults: Config = {
    channel: "",
    targetId: "",
    rateLimitMs: 2000,
    batchWindowMs: 8000,
    maxBatchSize: 15,
    maxMessageLength: 1700,
    maxFileSize: 10_000_000,
    maxSeenIds: 5000,
    agentEmojis: { clawd: "🦞" }
  };
  
  if (process.env.SESSION_AUDIT_CHANNEL) {
    defaults.channel = process.env.SESSION_AUDIT_CHANNEL;
  }
  if (process.env.SESSION_AUDIT_TARGET_ID) {
    defaults.targetId = process.env.SESSION_AUDIT_TARGET_ID;
  }
  if (process.env.SESSION_AUDIT_RATE_LIMIT_MS) {
    defaults.rateLimitMs = parseInt(process.env.SESSION_AUDIT_RATE_LIMIT_MS, 10);
  }
  if (process.env.SESSION_AUDIT_BATCH_WINDOW_MS) {
    defaults.batchWindowMs = parseInt(process.env.SESSION_AUDIT_BATCH_WINDOW_MS, 10);
  }
  if (process.env.SESSION_AUDIT_AGENT_EMOJIS) {
    try {
      defaults.agentEmojis = JSON.parse(process.env.SESSION_AUDIT_AGENT_EMOJIS);
    } catch {}
  }
  
  return defaults;
}

const CONFIG = loadConfig();
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";

const RATE_LIMIT_MS = CONFIG.rateLimitMs;
const BATCH_WINDOW_MS = CONFIG.batchWindowMs;
const MAX_BATCH_SIZE = CONFIG.maxBatchSize;
const MAX_SEEN_IDS = CONFIG.maxSeenIds;
const MAX_FILE_SIZE = CONFIG.maxFileSize;
const MAX_MESSAGE_LENGTH = CONFIG.maxMessageLength;

const TOOL_ICONS: Record<string, string> = {
  exec: "⚡", edit: "✏️", write: "📝", read: "📖", glob: "🔍", grep: "🔎",
  webfetch: "🌐", web_search: "🔎", bash: "💻", process: "⚙️",
  sessions_spawn: "🚀", sessions_list: "📋", delegate_task: "📤",
  task: "📋", http: "🌐", skill: "🎯", cache_docs: "📚",
  analyze_video: "🎬", analyze_image: "🖼️", ui_to_artifact: "🎨",
  diagnose_error: "❌", understand_diagram: "📊", analyze_data: "📈",
  ui_diff_check: "🔍", extract_text: "📄", web_reader: "📖",
  ask_question: "❓", call_agent: "🤖", slashcommand: "⚡",
  todo: "📝", update_todo: "📝", grep_search: "🔎", glob_search: "🔍",
  sed_replace: "✏️", diff: "📊", jq: "🔧", http_request: "🌐",
  file_stats: "📊", git_diff: "📊", git_status: "📊",
  run_background: "🔄", check_background: "🔍", list_background: "📋",
  kill_background: "🛑", ast_search: "🔍", ast_replace: "✏️",
  lsp_diagnostics: "🔍", delegate: "🤖", get_task_result: "📋",
  list_tasks: "📋", cancel_task: "🛑", list_agents: "📋", show_metrics: "📊",
};

const EVENT_ICONS: Record<string, string> = {
  user_message: "💬", assistant_complete: "✅", assistant_response: "✅",
  thinking: "💭", thinking_level: "🧠", error: "❌", model_change: "🔄",
  model_snapshot: "📸", context_compaction: "🗜️", image: "🖼️",
  tool_call: "🔧", tool_result: "📋", complete: "✅",
};

let retryAfterMs = 0;

interface PendingEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
  id: string;
  sessionKey: string;
  threadNumber?: string;
}

interface SessionMetadata {
  cwd: string;
  projectName: string;
  model: string;
  chatType: string;
  key: string;
  contextTokens?: string;
  provider?: string;
  surface?: string;
  updatedAt?: string;
  groupId?: string;
  thinkingLevel?: string;
}

interface State {
  offsets: Record<string, number>;
  seenIds: string[];
}

const sessionMetadata = new Map<string, SessionMetadata>();
const pendingEvents = new Map<string, PendingEvent[]>();
const batchTimers = new Map<string, NodeJS.Timeout>();

let state: State = { offsets: {}, seenIds: [] };
let seenIdsSet: Set<string> = new Set();

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      state = { offsets: data.offsets || {}, seenIds: data.seenIds || [] };
      seenIdsSet = new Set(state.seenIds);
      console.error("[session-audit] Loaded state with", state.seenIds.length, "seen IDs");
    }
  } catch (err) {
    console.error("[session-audit] Failed to load state:", err);
  }
}

function saveState() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    state.seenIds = [...seenIdsSet];
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[session-audit] Failed to save state:", err);
  }
}

function hasSeenId(id: string): boolean {
  if (seenIdsSet.has(id)) return true;
  seenIdsSet.add(id);
  if (seenIdsSet.size > MAX_SEEN_IDS) {
    const arr = [...seenIdsSet].slice(-MAX_SEEN_IDS);
    seenIdsSet = new Set(arr);
  }
  return false;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

function getBaseSessionId(filename: string): string {
  const match = filename.match(/^([a-f0-9-]{36})(?:-topic-\d+)?\.jsonl$/);
  return match ? match[1] : filename.replace(/\.jsonl$/, "");
}

function getThreadNumber(filename: string): string | null {
  const match = filename.match(/-topic-(\d+)\.jsonl$/);
  return match ? match[1] : null;
}

function getProjectInfo(sessionId: string) {
  const meta = sessionMetadata.get(sessionId);
  const shortId = sessionId.slice(0, 8);
  
  if (!meta) {
    return { name: shortId, emoji: "🤖", model: "", chatType: "unknown", shortId, 
             keyDisplay: shortId, isSubagent: false, cwd: "", contextTokens: "",
             provider: "", surface: "", updatedAt: "", groupId: "", thinkingLevel: "" };
  }
  
  const parts = meta.cwd?.split("/") || [];
  let projectName = parts[parts.length - 1] || shortId;
  if (projectName === "home" && parts.length > 2) projectName = parts[parts.length - 2];
  
  const isSubagent = meta.key?.includes(":") && !meta.key.startsWith("main:");
  const keyDisplay = meta.key ? meta.key.split(":").pop() || meta.key : shortId;
  const emoji = CONFIG.agentEmojis[projectName] || "🤖";
  
  return {
    name: projectName, emoji, model: meta.model ? ` (${meta.model.split("/").pop()})` : "",
    chatType: meta.chatType || "unknown", shortId, keyDisplay, isSubagent, cwd: meta.cwd || "",
    contextTokens: meta.contextTokens || "", provider: meta.provider || "",
    surface: meta.surface || "", updatedAt: meta.updatedAt || "",
    groupId: meta.groupId || "", thinkingLevel: meta.thinkingLevel || ""
  };
}

function formatEvent(event: PendingEvent): string {
  const time = formatTimestamp(event.timestamp);
  const { type, data } = event;
  const errorPrefix = data.error ? "❌ " : "";
  
  if (type === "tool_call" || type === "call") {
    const name = (data.name as string) || (data.tool_name as string) || "unknown";
    const icon = TOOL_ICONS[name] || "🔧";
    const durationStr = data.duration_ms ? ` (${formatDuration(data.duration_ms as number)})` : "";
    
    if (name === "exec" || name === "bash") {
      const cmd = (data.command as string) || "";
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(cmd, 60)}`;
    }
    if (name === "edit") {
      const file = (data.file_path as string) || (data.path as string) || "";
      const stats = [];
      if (data.lines_added) stats.push(`+${data.lines_added}`);
      if (data.lines_removed) stats.push(`-${data.lines_removed}`);
      const statsStr = stats.length ? ` [${stats.join(" ")}]` : "";
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(file.split("/").pop() || file, 50)}${statsStr}`;
    }
    if (name === "write" || name === "read") {
      const file = (data.file_path as string) || (data.path as string) || "";
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(file.split("/").pop() || file, 50)}`;
    }
    if (["grep_search", "glob_search", "grep", "glob"].includes(name)) {
      const pattern = (data.pattern as string) || "";
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(pattern, 40)}`;
    }
    if (["webfetch", "http", "http_request"].includes(name)) {
      const url = (data.url as string) || "";
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(url, 50)}`;
    }
    return `${time} ${errorPrefix}${icon} ${name}${durationStr}`;
  }
  
  if (type === "user_message") {
    const sender = (data.sender as string) || "User";
    const text = (data.text as string) || (data.content as string) || "";
    return `${time} ${errorPrefix}💬 ${sender}: ${truncateText(text.replace(/\n/g, " "), 80)}`;
  }
  
  if (type === "assistant_complete" || type === "complete") {
    const tokens = (data.tokens as number) || (data.output_tokens as number);
    const tokenStr = tokens ? ` (${tokens.toLocaleString()} tokens)` : "";
    const text = (data.text as string) || (data.content as string) || "";
    return `${time} ${errorPrefix}✅ Response completed${tokenStr}: "${truncateText(text.replace(/\n/g, " "), 60)}"`;
  }
  
  if (type === "thinking") {
    const text = (data.text as string) || "";
    return `${time} ${errorPrefix}💭 Thinking: ${truncateText(text.replace(/\n/g, " "), 80)}`;
  }
  
  if (type === "thinking_level") {
    const level = (data.level as string) || "unknown";
    return `${time} ${errorPrefix}🧠 Thinking level: ${level}`;
  }
  
  if (type === "error") {
    const msg = (data.message as string) || (data.error as string) || "Unknown error";
    return `${time} ❌ Error: ${truncateText(msg, 100)}`;
  }
  
  if (type === "model_change") {
    const to = data.to || data.model;
    return `${time} 🔄 Model: ${to}`;
  }
  
  if (type === "context_compaction") {
    return `${time} 🗜️ Context compaction`;
  }
  
  if (type === "image") {
    const mime = (data.mime_type as string) || "image";
    return `${time} 🖼️ Image: ${mime}`;
  }
  
  return `${time} 📌 ${type}`;
}

function sendMessage(text: string) {
  if (!CONFIG.channel || !CONFIG.targetId) {
    console.error("[session-audit] Missing channel or targetId");
    return;
  }
  
  const truncated = truncateText(text, MAX_MESSAGE_LENGTH);
  
  const child = spawn(OPENCLAW_BIN, [
    "message", "send", "--channel", CONFIG.channel,
    "--target", CONFIG.targetId, "--message", truncated, "--silent",
  ], { stdio: "ignore" });
  
  child.unref();
}

function buildMessage(groupKey: string, events: PendingEvent[]): string {
  let sessionKey = groupKey;
  let threadNumber: string | null = null;
  const threadMatch = groupKey.match(/^(.+)-topic-(\d+)$/);
  if (threadMatch) { sessionKey = threadMatch[1]; threadNumber = threadMatch[2]; }
  
  const info = getProjectInfo(sessionKey);
  const typeIcon = info.chatType === "direct" ? "👤" : info.chatType === "channel" ? "👥" : "";
  const subagentTag = info.isSubagent ? "[subagent]" : "";
  const threadTag = threadNumber ? ` [thread:${threadNumber}]` : "";
  
  const parts: string[] = [`${info.emoji}[${info.name}]${info.model}${subagentTag}${threadTag}`];
  const metaParts: string[] = [];
  const keyStr = info.keyDisplay || sessionKey.slice(0, 8);
  metaParts.push(typeIcon ? `${typeIcon}${keyStr}` : keyStr);
  if (info.cwd) metaParts.push(`📁${info.cwd}`);
  if (info.contextTokens) metaParts.push(`📊${info.contextTokens}`);
  if (info.thinkingLevel) metaParts.push(`🧠${info.thinkingLevel}`);
  if (info.surface) metaParts.push(`🖥️${info.surface}`);
  if (info.provider) metaParts.push(`🔌${info.provider}`);
  if (info.updatedAt) metaParts.push(`⏰${info.updatedAt}`);
  if (info.groupId) metaParts.push(`🔗${info.groupId.slice(0, 8)}`);
  if (metaParts.length > 0) parts.push(metaParts.join(" | "));
  
  const header = parts.join(" ");
  const lines: string[] = [header];
  let totalLen = header.length + 1;
  
  for (const event of events) {
    const formatted = formatEvent(event);
    if (totalLen + formatted.length + 1 > MAX_MESSAGE_LENGTH) break;
    lines.push(formatted);
    totalLen += formatted.length + 1;
  }
  
  return lines.join("\n");
}

async function flushEvents(groupKey: string) {
  const events = pendingEvents.get(groupKey);
  if (!events || events.length === 0) { pendingEvents.delete(groupKey); batchTimers.delete(groupKey); return; }
  pendingEvents.delete(groupKey);
  batchTimers.delete(groupKey);
  
  if (Date.now() < retryAfterMs) return;
  
  const message = buildMessage(groupKey, events);
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  sendMessage(message);
}

function scheduleFlush(groupKey: string) {
  if (batchTimers.has(groupKey)) return;
  const events = pendingEvents.get(groupKey) || [];
  if (events.length >= MAX_BATCH_SIZE) { flushEvents(groupKey).catch(console.error); return; }
  const timer = setTimeout(() => { flushEvents(groupKey).catch(console.error); }, BATCH_WINDOW_MS);
  batchTimers.set(groupKey, timer);
}

function addEvent(sessionKey: string, event: PendingEvent) {
  const groupKey = event.threadNumber ? `${sessionKey}-topic-${event.threadNumber}` : sessionKey;
  if (!pendingEvents.has(groupKey)) pendingEvents.set(groupKey, []);
  pendingEvents.get(groupKey)!.push(event);
  scheduleFlush(groupKey);
}

async function tailFile(filename: string): Promise<void> {
  if (!filename.endsWith(".jsonl")) return;
  const filepath = join(SESSIONS_DIR, filename);
  
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try { fileStat = await stat(filepath); if (fileStat.size > MAX_FILE_SIZE) return; }
  catch { return; }
  
  if (state.offsets[filename] === undefined) state.offsets[filename] = fileStat.size;
  const offset = state.offsets[filename];
  const baseSessionId = getBaseSessionId(filename);
  const threadNumber = getThreadNumber(filename);
  const sessionKey = baseSessionId;
  
  try {
    const stream = createReadStream(filepath, { start: offset, encoding: "utf8" });
    const rl = createInterface({ input: stream });
    let newOffset = offset;
    
    for await (const line of rl) {
      if (!line.trim()) continue;
      newOffset += Buffer.byteLength(line, "utf8") + 1;
      
      try {
        const row = JSON.parse(line);
        const rowType = row?.type;
        
        if (rowType === "session" && row?.cwd) {
          const parts = row.cwd.split("/");
          const projectName = parts[parts.length - 1] || sessionKey;
          const existing = sessionMetadata.get(sessionKey);
          sessionMetadata.set(sessionKey, { cwd: row.cwd, projectName, model: existing?.model || "",
            chatType: existing?.chatType || "unknown", key: existing?.key || "", contextTokens: existing?.contextTokens,
            provider: existing?.provider, surface: existing?.surface, updatedAt: existing?.updatedAt,
            groupId: existing?.groupId, thinkingLevel: existing?.thinkingLevel });
        }
        
        if (rowType === "model_snapshot" && row?.modelId) {
          const existing = sessionMetadata.get(sessionKey);
          if (existing) sessionMetadata.set(sessionKey, { ...existing, model: row.modelId });
        }
        
        if (rowType === "model_change" && row?.to) {
          const existing = sessionMetadata.get(sessionKey);
          if (existing) sessionMetadata.set(sessionKey, { ...existing, model: row.to });
          const eventId = `model_change:${row.to}:${Date.now()}`;
          if (!hasSeenId(eventId)) addEvent(sessionKey, { type: "model_change", timestamp: Date.now(),
            data: { from: row.from, to: row.to }, id: eventId, sessionKey,
            threadNumber: threadNumber || undefined });
        }
        
        if (rowType === "thinking_level" && row?.level !== undefined) {
          const existing = sessionMetadata.get(sessionKey);
          if (existing) sessionMetadata.set(sessionKey, { ...existing, thinkingLevel: row.level });
          const eventId = `thinking_level:${row.level}:${Date.now()}`;
          if (!hasSeenId(eventId)) addEvent(sessionKey, { type: "thinking_level", timestamp: Date.now(),
            data: { level: row.level }, id: eventId, sessionKey, threadNumber: threadNumber || undefined });
        }
        
        if (rowType === "user_message") {
          const eventId = `user_message:${sessionKey}:${row.timestamp || Date.now()}`;
          if (!hasSeenId(eventId)) addEvent(sessionKey, { type: "user_message", timestamp: row.timestamp || Date.now(),
            data: row, id: eventId, sessionKey, threadNumber: threadNumber || undefined });
        }
        
        if (rowType === "assistant_complete" || rowType === "complete") {
          const eventId = `complete:${sessionKey}:${row.timestamp || Date.now()}`;
          if (!hasSeenId(eventId)) {
            const existing = sessionMetadata.get(sessionKey);
            if (existing && row.contextTokens) sessionMetadata.set(sessionKey, { ...existing, contextTokens: row.contextTokens });
            addEvent(sessionKey, { type: "assistant_complete", timestamp: row.timestamp || Date.now(),
              data: row, id: eventId, sessionKey, threadNumber: threadNumber || undefined });
          }
        }
        
        if (rowType === "thinking" && row?.text) {
          const textPreview = row.text.slice(0, 50);
          const eventId = `thinking:${sessionKey}:${textPreview}:${row.timestamp || Date.now()}`;
          if (!hasSeenId(eventId)) addEvent(sessionKey, { type: "thinking", timestamp: row.timestamp || Date.now(),
            data: row, id: eventId, sessionKey, threadNumber: threadNumber || undefined });
        }
        
        if (row?.callId && (rowType === "tool_call" || rowType === "call")) {
          const eventId = `call_${row.callId}`;
          if (!hasSeenId(eventId)) addEvent(sessionKey, { type: "tool_call", timestamp: row.timestamp || Date.now(),
            data: row, id: eventId, sessionKey, threadNumber: threadNumber || undefined });
        }
        
      } catch { /* skip unparseable */ }
    }
    state.offsets[filename] = newOffset;
  } catch (err) { console.error(`[session-audit] Error reading ${filename}:`, err); }
}

async function scanSessions() {
  try {
    const files = readdirSync(SESSIONS_DIR);
    for (const file of files) if (file.endsWith(".jsonl")) await tailFile(file);
    saveState();
  } catch (err) { console.error("[session-audit] Error scanning sessions:", err); }
}

function startWatcher() {
  try {
    const watcher = watch(SESSIONS_DIR, (eventType, filename) => {
      if (filename && filename.endsWith(".jsonl")) tailFile(filename).catch(console.error);
    });
    watcher.on("error", (err) => console.error("[session-audit] Watcher error:", err));
    console.error("[session-audit] Watching", SESSIONS_DIR);
  } catch (err) { console.error("[session-audit] Failed to start watcher:", err); }
}

function writePidFile() {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(PID_FILE, String(process.pid)); }
  catch (err) { console.error("[session-audit] Failed to write PID file:", err); }
}

async function main() {
  console.error("[session-audit] Starting daemon...");
  console.error("[session-audit] Config - channel:", CONFIG.channel, "targetId:", CONFIG.targetId);
  
  if (!CONFIG.channel || !CONFIG.targetId) {
    console.error("[session-audit] ERROR: Missing channel or targetId.");
    process.exit(1);
  }
  
  writePidFile();
  loadState();
  await scanSessions();
  startWatcher();
  setInterval(saveState, 30000);
}

main().catch(console.error);
