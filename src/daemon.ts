import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const CONFIG_FILE = join(PROJECT_ROOT, "config.json");
const SESSIONS_DIR = join(homedir(), ".openclaw", "agents", "main", "sessions");
const STATE_DIR = join(PROJECT_ROOT, "state");
const STATE_FILE = join(STATE_DIR, "state.json");
const PID_FILE = join(STATE_DIR, "daemon.pid");
const SESSIONS_JSON = join(SESSIONS_DIR, "sessions.json");

type SendMethod = "webhook" | "fallback" | "auto";

interface Config {
  webhookUrl: string;
  fallbackChannelId: string;
  sendMethod: SendMethod;
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
    webhookUrl: "",
    fallbackChannelId: "",
    sendMethod: "auto",
    rateLimitMs: 2000,
    batchWindowMs: 8000,
    maxBatchSize: 15,
    maxMessageLength: 1700,
    maxFileSize: 10_000_000,
    maxSeenIds: 5000,
    agentEmojis: { clawd: "🦞" }
  };
  
  try {
    if (existsSync(CONFIG_FILE)) {
      const fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      Object.assign(defaults, fileConfig);
    }
  } catch (err) {
    console.error("[discord-audit-stream] Failed to load config.json:", err);
  }
  
  // Env overrides
  if (process.env.DISCORD_AUDIT_WEBHOOK_URL) {
    defaults.webhookUrl = process.env.DISCORD_AUDIT_WEBHOOK_URL;
  }
  if (process.env.DISCORD_AUDIT_CHANNEL_ID) {
    defaults.fallbackChannelId = process.env.DISCORD_AUDIT_CHANNEL_ID;
  }
  if (process.env.DISCORD_AUDIT_SEND_METHOD) {
    defaults.sendMethod = process.env.DISCORD_AUDIT_SEND_METHOD as SendMethod;
  }
  if (process.env.DISCORD_AUDIT_RATE_LIMIT_MS) {
    defaults.rateLimitMs = parseInt(process.env.DISCORD_AUDIT_RATE_LIMIT_MS, 10);
  }
  if (process.env.DISCORD_AUDIT_BATCH_WINDOW_MS) {
    defaults.batchWindowMs = parseInt(process.env.DISCORD_AUDIT_BATCH_WINDOW_MS, 10);
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
  exec: "⚡",
  edit: "✏️",
  write: "📝",
  read: "📖",
  glob: "🔍",
  grep: "🔎",
  webfetch: "🌐",
  web_search: "🔎",
  bash: "💻",
  process: "⚙️",
  sessions_spawn: "🚀",
  sessions_list: "📋",
  delegate_task: "📤",
  task: "📋",
  call_agent: "🤖",
  skill: "🎯",
  http: "🔗",
  jq: "📊",
  diff: "🔀",
  sed_replace: "🔄",
  glob_search: "📁",
  grep_search: "🔍",
  ast_search: "🌳",
  ast_replace: "🔄",
  lsp_diagnostics: "🩺",
  todowrite: "✅",
  update_todo: "✅",
  list_agents: "👥",
  delegate: "📤",
  cache_docs: "📦",
  run_background: "⏳",
  check_background: "⏱️",
  list_background: "📋",
  kill_background: "💀",
  file_stats: "📊",
  git_status: "📝",
  git_diff: "🔀",
};

const EVENT_ICONS: Record<string, string> = {
  user_message: "💬",
  assistant_complete: "✅",
  thinking: "💭",
  prompt_error: "❌",
  model_change: "🔄",
  compaction: "🗜️",
  image: "🖼️",
  thinking_level: "🧠",
};

const LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".json": "json",
  ".md": "markdown",
  ".sh": "bash",
  ".bash": "bash",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sql": "sql",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".lua": "lua",
  ".r": "r",
  ".toml": "toml",
  ".ini": "ini",
  ".env": "bash",
  ".dockerfile": "dockerfile",
  "Dockerfile": "dockerfile",
  ".makefile": "makefile",
  "Makefile": "makefile",
};

interface State {
  offsets: Record<string, number>;
  seenIds: string[];
  lastSend: number;
}

interface PendingEvent {
  type: string;
  id: string;
  sessionId: string;
  threadNumber: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}

let state: State = {
  offsets: {},
  seenIds: [],
  lastSend: 0,
};

let seenIdsSet: Set<string> = new Set();
const pendingEvents: Map<string, PendingEvent[]> = new Map();
const sessionMetadata: Map<string, { 
  cwd: string; 
  projectName: string; 
  model: string; 
  chatType: string; 
  key: string;
  contextTokens?: number;
  usedTokens?: number;
  provider?: string;
  surface?: string;
  updatedAt?: number;
  groupId?: string;
  thinkingLevel?: string;
}> = new Map();
const toolCallTimestamps: Map<string, { timestamp: number; sessionId: string }> = new Map();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
let retryAfterMs = 0;
let isFlushing = false;

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      state = {
        offsets: data.offsets || {},
        seenIds: data.seenIds || [],
        lastSend: data.lastSend || 0,
      };
      seenIdsSet = new Set(state.seenIds);
    }
  } catch {
    console.error("[discord-audit-stream] Failed to load state, starting fresh");
  }
}

function loadSessionsJson() {
  try {
    if (!existsSync(SESSIONS_JSON)) return;
    const data = JSON.parse(readFileSync(SESSIONS_JSON, "utf8"));
    for (const [key, value] of Object.entries(data)) {
      const session = value as { 
        sessionId?: string; 
        model?: string; 
        origin?: { chatType?: string; provider?: string; surface?: string };
        contextTokens?: number;
        updatedAt?: number;
        groupId?: string;
      };
      if (session?.sessionId) {
        const existing = sessionMetadata.get(session.sessionId);
        if (existing) {
          if (session.model) existing.model = session.model;
          if (session.origin?.chatType) existing.chatType = session.origin.chatType;
          if (session.origin?.provider) existing.provider = session.origin.provider;
          if (session.origin?.surface) existing.surface = session.origin.surface;
          if (session.contextTokens) existing.contextTokens = session.contextTokens;
          if (session.updatedAt) existing.updatedAt = session.updatedAt;
          if (session.groupId) existing.groupId = session.groupId;
          if (key) existing.key = key;
        } else {
          sessionMetadata.set(session.sessionId, {
            cwd: "",
            projectName: session.sessionId.slice(0, 8),
            model: session.model || "",
            chatType: session.origin?.chatType || "unknown",
            key: key || "",
            contextTokens: session.contextTokens,
            provider: session.origin?.provider,
            surface: session.origin?.surface,
            updatedAt: session.updatedAt,
            groupId: session.groupId,
          });
        }
      }
    }
  } catch (err) {
    console.error("[discord-audit-stream] Failed to load sessions.json:", err);
  }
}

function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      state.seenIds = [...seenIdsSet];
      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[discord-audit-stream] Failed to save state:", err);
    }
  }, 100);
}

function writePidFile() {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
  } catch {}
}

function canSend(): boolean {
  const now = Date.now();
  if (now < retryAfterMs) return false;
  if (now - state.lastSend < RATE_LIMIT_MS) return false;
  state.lastSend = now;
  return true;
}

function isSeen(id: string): boolean {
  if (seenIdsSet.has(id)) return true;
  seenIdsSet.add(id);
  if (seenIdsSet.size > MAX_SEEN_IDS) {
    const arr = [...seenIdsSet].slice(-MAX_SEEN_IDS);
    seenIdsSet = new Set(arr);
  }
  saveState();
  return false;
}

function truncateText(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen - 25);
  const remaining = text.length - truncated.length;
  return `${truncated}... (+${remaining.toLocaleString()} chars)`;
}

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || "🔧";
}

function getEventIcon(type: string): string {
  return EVENT_ICONS[type] || "📌";
}

function detectLanguage(path: string): string {
  if (!path) return "text";
  const filename = path.split("/").pop() || "";
  if (LANG_MAP[filename]) return LANG_MAP[filename];
  const ext = extname(filename).toLowerCase();
  return LANG_MAP[ext] || "text";
}

function extractSummary(args: Record<string, unknown>): string {
  const priorities = [
    "path", "file_path", "filePath",
    "command",
    "prompt", "description", "query",
    "url", "pattern", "include",
    "task", "agent",
    "sessionId", "taskId",
    "message", "content",
    "id", "name"
  ];
  for (const key of priorities) {
    if (args?.[key] !== undefined && args[key] !== null && args[key] !== "") {
      const val = String(args[key]).replace(/\n/g, " ").trim();
      return truncateText(val, 80);
    }
  }
  return "";
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = Math.floor(date.getMilliseconds() / 10).toString().padStart(2, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function parseDiffStats(diff: string | undefined): { added: number; removed: number; addedChars: number; removedChars: number } | undefined {
  if (!diff) return undefined;
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;
  let addedChars = 0;
  let removedChars = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      addedChars += line.length - 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      removedChars += line.length - 1;
    }
  }
  return (added > 0 || removed > 0) ? { added, removed, addedChars, removedChars } : undefined;
}

function getProjectInfo(sessionId: string): { 
  name: string; 
  emoji: string; 
  model: string; 
  chatType: string; 
  shortId: string; 
  keyDisplay: string;
  isSubagent: boolean;
  cwd: string;
  contextTokens: string;
  provider: string;
  surface: string;
  updatedAt: string;
  groupId: string;
  thinkingLevel: string;
} {
  const meta = sessionMetadata.get(sessionId);
  const shortId = sessionId.slice(0, 8);
  
  if (!meta) {
    return { 
      name: shortId, 
      emoji: "🤖", 
      model: "", 
      chatType: "unknown", 
      shortId, 
      keyDisplay: shortId,
      isSubagent: false,
      cwd: "",
      contextTokens: "",
      provider: "",
      surface: "",
      updatedAt: "",
      groupId: "",
      thinkingLevel: ""
    };
  }
  
  const emoji = CONFIG.agentEmojis[meta.projectName] || "🤖";
  const model = meta.model ? ` (${meta.model})` : "";
  const chatType = meta.chatType || "unknown";
  const isSubagent = meta.key?.includes("subag") || false;
  const keyDisplay = meta.key || "";
  const cwd = meta.cwd || "";
  
  let contextTokens = "";
  if (meta.usedTokens && meta.contextTokens) {
    const pct = Math.round((meta.usedTokens / meta.contextTokens) * 100);
    contextTokens = `${Math.round(meta.usedTokens / 1000)}k/${Math.round(meta.contextTokens / 1000)}k (${pct}%)`;
  } else if (meta.contextTokens) {
    contextTokens = `${Math.round(meta.contextTokens / 1000)}k`;
  }
  
  const provider = meta.provider || "";
  const surface = meta.surface || "";
  const updatedAt = meta.updatedAt ? new Date(meta.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  const groupId = meta.groupId || "";
  const thinkingLevel = meta.thinkingLevel || "";
  const name = meta.projectName || shortId;
  
  return { name, emoji, model, chatType, shortId, keyDisplay, isSubagent, cwd, contextTokens, provider, surface, updatedAt, groupId, thinkingLevel };
}

function formatDuration(ms: number | null): string {
  if (ms === null || isNaN(ms) || ms <= 0) return "";
  if (ms < 1000) return `(${Math.round(ms)}ms)`;
  if (ms < 60000) return `(${(ms / 1000).toFixed(1)}s)`;
  return `(${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s)`;
}

function formatEvent(event: PendingEvent): string {
  const time = formatTime(event.timestamp);
  const data = event.data;
  
  switch (event.type) {
    case "toolCall": {
      const name = String(data.name || "");
      const args = data.args as Record<string, unknown> || {};
      const isError = data.isError === true;
      const durationMs = data.durationMs as number | null;
      const diffStats = data.diffStats as { added: number; removed: number; addedChars: number; removedChars: number } | undefined;
      const icon = getToolIcon(name);
      const duration = formatDuration(durationMs);
      const durationStr = duration ? ` ${duration}` : "";
      const errorPrefix = isError ? "❌ " : "";
      const cmd = String(args?.command || "");
      const path = String(args?.path || args?.file_path || args?.filePath || "");

      if (name === "exec") {
        const code = cmd || "(empty)";
        const formatted = `\`\`\`bash\n${code}\n\`\`\``;
        const truncatedFormatted = truncateText(formatted, 450);
        return `${time} ${errorPrefix}${icon} exec${durationStr}:\n${truncatedFormatted}`;
      }

      if (name === "edit" || name === "write") {
        const summary = path || "(unknown)";
        let diffStr = "";
        if (diffStats) {
          diffStr = ` (+${diffStats.added}/-${diffStats.removed} lines, +${diffStats.addedChars}/-${diffStats.removedChars} chars)`;
        }
        return `${time} ${errorPrefix}${icon} ${name}${durationStr}${diffStr}: \`${summary}\``;
      }

      if (name === "read") {
        return `${time} ${errorPrefix}${icon} read${durationStr}: \`${path || "(unknown)"}\``;
      }

      if (name === "process") {
        const action = String(args?.action || "");
        const sessId = String(args?.sessionId || "");
        return `${time} ${errorPrefix}${icon} process${durationStr}: ${action} → ${sessId}`;
      }

      if (name === "sessions_spawn") {
        const prompt = String(args?.prompt || "");
        const agent = String(args?.agent || "");
        const task = String(args?.task || "");
        if (prompt) return `${time} ${errorPrefix}${icon} sessions_spawn${durationStr}: ${truncateText(prompt, 60)}`;
        if (agent && task) return `${time} ${errorPrefix}${icon} sessions_spawn${durationStr}: ${agent} - ${truncateText(task, 50)}`;
        if (agent) return `${time} ${errorPrefix}${icon} sessions_spawn${durationStr}: agent=${agent}`;
      }

      if (name === "sessions_list") {
        return `${time} ${errorPrefix}${icon} sessions_list${durationStr}: list active sessions`;
      }

      if (name === "message") {
        const channel = String(args?.channel || "");
        const target = String(args?.target || "");
        const msgPreview = String(args?.message || "").slice(0, 50);
        if (channel && target) {
          return `${time} ${errorPrefix}${icon} message${durationStr}: ${channel} → ${target} "${truncateText(msgPreview, 30)}"`;
        }
        return `${time} ${errorPrefix}${icon} message${durationStr}: ${channel || target || msgPreview || "(unknown)"}`;
      }

      const summary = extractSummary(args);
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${summary || "(unknown)"}`;
    }
    
    case "user_message": {
      const icon = getEventIcon("user_message");
      const sender = String(data.sender || "User");
      const preview = String(data.preview || "");
      const hasImage = data.hasImage === true;
      const imageMeta = data.imageMeta as string[] | undefined;
      
      // Skip metadata-only messages (just "...." or empty after extraction)
      if (!preview || preview.trim() === "...." || preview.trim() === "") {
        return null;
      }
      
      // Code block format with 3000 char limit
      const truncatedPreview = preview.length > 3000 ? preview.slice(0, 3000) + "..." : preview;
      let msg = `${time} ${icon} ${sender}:\n\`\`\`\n${truncatedPreview}\n\`\`\``;
      if (hasImage) {
        msg += ` [🖼️ image`;
        if (imageMeta && imageMeta.length > 0) {
          msg += `: ${imageMeta.join(", ")}`;
        }
        msg += "]";
      }
      return msg;
    }
    
    case "assistant_complete": {
      const icon = getEventIcon("assistant_complete");
      const tokens = data.tokens as number | undefined;
      const messagePreview = data.messagePreview as string | undefined;
      let msg = `${time} ${icon} Response completed`;
      if (tokens) {
        msg += ` (${tokens.toLocaleString()} tokens)`;
      }
      if (messagePreview) {
        msg += `: "${truncateText(messagePreview, 100)}"`;
      }
      return msg;
    }
    
    case "thinking": {
      const icon = getEventIcon("thinking");
      const preview = String(data.preview || "");
      return `${time} ${icon} Thinking: "${truncateText(preview, 100)}"`;
    }
    
    case "prompt_error": {
      const icon = getEventIcon("prompt_error");
      const error = String(data.error || "unknown");
      const model = String(data.model || "");
      return `${time} ${icon} Prompt error${model ? ` (${model})` : ""}: ${error}`;
    }
    
    case "model_change": {
      const icon = getEventIcon("model_change");
      const oldModel = String(data.oldModel || "");
      const newModel = String(data.newModel || "");
      if (oldModel && newModel) {
        return `${time} ${icon} Model changed: ${oldModel} → ${newModel}`;
      }
      return `${time} ${icon} Model changed: ${newModel}`;
    }
    
    case "compaction": {
      const icon = getEventIcon("compaction");
      const tokensBefore = data.tokensBefore as number | undefined;
      const summary = String(data.summary || "");
      const summaryPreview = truncateText(summary.replace(/\n/g, " "), 100);
      let msg = `${time} ${icon} Context compacted`;
      if (tokensBefore) {
        msg += ` (${Math.round(tokensBefore / 1000)}k tokens)`;
      }
      if (summaryPreview) {
        msg += `: ${summaryPreview}`;
      }
      return msg;
    }
    
    case "image": {
      const icon = getEventIcon("image");
      const mimeType = String(data.mimeType || "unknown");
      const source = String(data.source || "");
      return `${time} ${icon} Image received: ${mimeType}${source ? ` (${truncateText(source, 30)})` : ""}`;
    }
    
    case "thinking_level": {
      const icon = getEventIcon("thinking_level");
      const level = String(data.level || "unknown");
      return `${time} ${icon} Thinking level: ${level}`;
    }
    
    default:
      return `${time} 📌 ${event.type}: ${truncateText(JSON.stringify(data), 80)}`;
  }
}

async function sendViaWebhook(text: string): Promise<boolean> {
  if (!CONFIG.webhookUrl) {
    console.error("[discord-audit-stream] No webhook URL configured");
    return false;
  }
  try {
    const res = await fetch(CONFIG.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      retryAfterMs = Date.now() + (parseInt(retryAfter || "5", 10) * 1000);
      console.error("[discord-audit-stream] Rate limited, retry after:", retryAfter);
      return false;
    }
    
    return res.ok;
  } catch (err) {
    console.error("[discord-audit-stream] Webhook error:", err);
    return false;
  }
}

function sendViaFallback(text: string) {
  const child = spawn(OPENCLAW_BIN, [
    "message",
    "send",
    "--channel",
    "discord",
    "--target",
    `channel:${CONFIG.fallbackChannelId}`,
    "--message",
    text,
    "--silent",
  ], { stdio: "ignore" });
  child.unref();
}

async function sendMessage(text: string) {
  const truncated = truncateText(text, MAX_MESSAGE_LENGTH);
  
  switch (CONFIG.sendMethod) {
    case "webhook":
      await sendViaWebhook(truncated);
      break;
    case "fallback":
      sendViaFallback(truncated);
      break;
    case "auto":
    default:
      const success = await sendViaWebhook(truncated);
      if (!success) {
        sendViaFallback(truncated);
      }
      break;
  }
}

function buildMessage(groupKey: string, events: PendingEvent[]): string {
  // Extract session key and thread number from groupKey
  let sessionKey = groupKey;
  let threadNumber: string | null = null;
  const threadMatch = groupKey.match(/^(.+)-topic-(\d+)$/);
  if (threadMatch) {
    sessionKey = threadMatch[1];
    threadNumber = threadMatch[2];
  }
  
  // Also check first event for thread number
  if (!threadNumber && events.length > 0 && events[0].threadNumber) {
    threadNumber = events[0].threadNumber;
  }
  
  const info = getProjectInfo(sessionKey);
  const typeIcon = info.chatType === "direct" ? "👤" : info.chatType === "channel" ? "👥" : "";
  const subagentTag = info.isSubagent ? "[subagent]" : "";
  const threadTag = threadNumber ? ` [thread:${threadNumber}]` : "";
  
  const parts: string[] = [];
  parts.push(`${info.emoji}[${info.name}]${info.model}${subagentTag}${threadTag}`);
  
  const metaParts: string[] = [];
  const keyStr = info.keyDisplay || sessionKey.slice(0, 8);
  if (typeIcon) {
    metaParts.push(`${typeIcon}${keyStr}`);
  } else {
    metaParts.push(keyStr);
  }
  if (info.cwd) metaParts.push(`📁${info.cwd}`);
  if (info.contextTokens) metaParts.push(`📊${info.contextTokens}`);
  if (info.thinkingLevel) metaParts.push(`🧠${info.thinkingLevel}`);
  if (info.surface) metaParts.push(`🖥️${info.surface}`);
  if (info.provider) metaParts.push(`🔌${info.provider}`);
  if (info.updatedAt) metaParts.push(`⏰${info.updatedAt}`);
  if (info.groupId) metaParts.push(`🔗${info.groupId.slice(0, 8)}`);
  
  if (metaParts.length > 0) {
    parts.push(metaParts.join(" | "));
  }
  
  const header = parts.join(" ");
  const lines: string[] = [header];
  let totalLen = header.length + 1;
  
  for (const event of events) {
    const formatted = formatEvent(event);
    if (!formatted) continue; // Skip null results (e.g., metadata-only messages)
    if (totalLen + formatted.length + 1 > MAX_MESSAGE_LENGTH - 50) {
      const remaining = events.length - lines.length + 1;
      if (remaining > 0) {
        lines.push(`• … +${remaining} more`);
      }
      break;
    }
    lines.push(formatted);
    totalLen += formatted.length + 1;
  }
  
  return lines.join("\n");
}

async function flushBatch() {
  if (isFlushing) return;
  isFlushing = true;
  batchTimer = null;
  
  if (pendingEvents.size === 0) {
    isFlushing = false;
    return;
  }
  
  const entries = [...pendingEvents.entries()];
  pendingEvents.clear();
  
  for (const [groupKey, events] of entries) {
    if (events.length === 0) continue;
    
    if (!canSend()) {
      if (!pendingEvents.has(groupKey)) pendingEvents.set(groupKey, []);
      pendingEvents.get(groupKey)!.push(...events);
      continue;
    }
    
    const text = buildMessage(groupKey, events);
    await sendMessage(text);
  }
  
  isFlushing = false;
  
  if (pendingEvents.size > 0) {
    batchTimer = setTimeout(flushBatch, RATE_LIMIT_MS);
  }
}

function getTotalPendingEvents(): number {
  let total = 0;
  for (const events of pendingEvents.values()) {
    total += events.length;
  }
  return total;
}

function scheduleFlush() {
  if (getTotalPendingEvents() >= MAX_BATCH_SIZE) {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = null;
    flushBatch();
    return;
  }
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
}

function addEvent(sessionKey: string, threadNumber: string | null, event: PendingEvent) {
  event.sessionId = sessionKey;
  event.threadNumber = threadNumber;
  // Use sessionKey + thread as the grouping key
  const groupKey = threadNumber ? `${sessionKey}-topic-${threadNumber}` : sessionKey;
  if (!pendingEvents.has(groupKey)) pendingEvents.set(groupKey, []);
  pendingEvents.get(groupKey)!.push(event);
  scheduleFlush();
}

function extractSenderName(content: unknown[]): string {
  for (const item of content) {
    if (item?.type === "text") {
      const text = item.text || "";
      // Try to extract sender from Discord metadata
      const senderMatch = text.match(/"(?:label|name|username)":\s*"([^"]+)"/);
      if (senderMatch) return senderMatch[1];
    }
  }
  return "User";
}

function extractImageMetadata(content: unknown[]): string[] {
  const metadata: string[] = [];
  for (const item of content) {
    if (item?.type === "image") {
      const img = item as { mimeType?: string; source?: { type?: string; data?: string; url?: string } };
      if (img.mimeType) {
        metadata.push(img.mimeType);
      }
      if (img.source?.type) {
        metadata.push(`source:${img.source.type}`);
      }
    }
  }
  return metadata;
}

function getBaseSessionId(filename: string): string {
  // Strip .jsonl and -topic-N suffix
  // "abc123-topic-613.jsonl" → "abc123"
  // "abc123.jsonl" → "abc123"
  let id = filename.replace(".jsonl", "");
  const topicMatch = id.match(/^(.+)-topic-\d+$/);
  if (topicMatch) {
    return topicMatch[1];
  }
  return id;
}

function getThreadNumber(filename: string): string | null {
  const match = filename.match(/-topic-(\d+)\.jsonl$/);
  return match ? match[1] : null;
}

async function tailFile(filename: string): Promise<void> {
  if (!filename.endsWith(".jsonl")) return;
  
  const filepath = join(SESSIONS_DIR, filename);
  
  try {
    const s = await stat(filepath);
    if (s.size > MAX_FILE_SIZE) return;
  } catch {
    return;
  }
  
  const offset = state.offsets[filename] ?? 0;
  const baseSessionId = getBaseSessionId(filename);
  const threadNumber = getThreadNumber(filename);
  // Use base session ID as key for metadata lookup
  const sessionKey = baseSessionId;
  
  try {
    const stream = createReadStream(filepath, { start: offset, encoding: "utf8" });
    const rl = createInterface({ input: stream });
    
    let newOffset = offset;
    let hasNewEvents = false;
    
    for await (const line of rl) {
      if (!line.trim()) continue;
      newOffset += Buffer.byteLength(line, "utf8") + 1;
      
      try {
        const row = JSON.parse(line);
        const rowType = row?.type;
        
        // Parse session metadata
        if (rowType === "session" && row?.cwd) {
          const parts = row.cwd.split("/");
          const projectName = parts[parts.length - 1] || sessionKey;
          const existing = sessionMetadata.get(sessionKey);
          sessionMetadata.set(sessionKey, { 
            cwd: row.cwd, 
            projectName, 
            model: existing?.model || "",
            chatType: existing?.chatType || "unknown",
            key: existing?.key || "",
            contextTokens: existing?.contextTokens,
            usedTokens: existing?.usedTokens,
            provider: existing?.provider,
            surface: existing?.surface,
            updatedAt: existing?.updatedAt,
            groupId: existing?.groupId,
            thinkingLevel: existing?.thinkingLevel
          });
        }
        
        // Track thinking level changes
        if (rowType === "thinking_level_change") {
          const level = row.thinkingLevel || "unknown";
          const existing = sessionMetadata.get(sessionKey);
          if (existing) existing.thinkingLevel = level;
          
          const id = `thinking_level:${row.id || Date.now()}`;
          if (!isSeen(id)) {
            addEvent(sessionKey, threadNumber, {
              type: "thinking_level",
              id,
              sessionId: sessionKey,
              timestamp: parseTimestamp(row.timestamp),
              data: { level }
            });
            hasNewEvents = true;
          }
        }
        
        // Track model changes
        if (rowType === "model_change" && row?.modelId) {
          const existing = sessionMetadata.get(sessionKey);
          const oldModel = existing?.model || "";
          const newModel = row.modelId;
          if (existing) existing.model = newModel;
          
          const id = `model_change:${row.id || Date.now()}`;
          if (!isSeen(id)) {
            addEvent(sessionKey, threadNumber, {
              type: "model_change",
              id,
              sessionId: sessionKey,
              timestamp: parseTimestamp(row.timestamp),
              data: { oldModel, newModel }
            });
            hasNewEvents = true;
          }
        }
        
        // Track custom events
        if (rowType === "custom") {
          const customType = row.customType;
          
          if (customType === "model-snapshot" && row?.data?.modelId) {
            const existing = sessionMetadata.get(sessionKey);
            const oldModel = existing?.model || "";
            const newModel = row.data.modelId;
            if (existing && newModel !== oldModel) {
              existing.model = newModel;
              
              const id = `model_snapshot:${row.id || Date.now()}`;
              if (!isSeen(id)) {
                addEvent(sessionKey, threadNumber, {
                  type: "model_change",
                  id,
                  sessionId: sessionKey,
                  timestamp: parseTimestamp(row.timestamp),
                  data: { oldModel, newModel }
                });
                hasNewEvents = true;
              }
            }
          }
          
          if (customType === "openclaw:prompt-error") {
            const id = `prompt_error:${row.id || Date.now()}`;
            if (!isSeen(id)) {
              addEvent(sessionKey, threadNumber, {
                type: "prompt_error",
                id,
                sessionId: sessionKey,
                timestamp: parseTimestamp(row.timestamp),
                data: {
                  error: row.data?.error,
                  model: row.data?.model,
                  provider: row.data?.provider
                }
              });
              hasNewEvents = true;
            }
          }
        }
        
        // Track compaction
        if (rowType === "compaction") {
          const id = `compaction:${row.id || Date.now()}`;
          if (!isSeen(id)) {
            addEvent(sessionKey, threadNumber, {
              type: "compaction",
              id,
              sessionId: sessionKey,
              timestamp: parseTimestamp(row.timestamp),
              data: {
                tokensBefore: row.tokensBefore,
                summary: row.summary
              }
            });
            hasNewEvents = true;
          }
        }
        
        // Track token usage
        if (row?.message?.usage?.totalTokens) {
          const existing = sessionMetadata.get(sessionKey);
          if (existing) {
            existing.usedTokens = row.message.usage.totalTokens;
          }
        }
        
        const message = row?.message;
        if (!message) continue;
        
        // Track user messages
        if (message.role === "user" && Array.isArray(message.content)) {
          const textItem = message.content.find((c: { type?: string }) => c.type === "text");
          let text = textItem?.text || "";
          
          // Extract actual user message from metadata-wrapped Discord messages
          // Pattern 1: "[Image] User text: <actual message>"
          const userTextMatch = text.match(/\[Image\]\s*User text:\s*([\s\S]+)/);
          if (userTextMatch) {
            text = userTextMatch[1].trim();
          } else if (text.includes("Conversation info (untrusted metadata)")) {
            // Pattern 2: After all metadata blocks, get remaining text
            // Find the last ``` and get text after it
            const parts = text.split(/```/);
            if (parts.length > 1) {
              // Get last part after final ```
              const lastPart = parts[parts.length - 1].trim();
              // Skip if it's just metadata keywords or "...."
              if (lastPart && !lastPart.includes("metadata") && lastPart !== "...." && lastPart.length > 5) {
                text = lastPart;
              } else {
                text = ""; // No actual user message found
              }
            } else {
              text = "";
            }
          }
          
          const sender = extractSenderName(message.content);
          const imageMeta = extractImageMetadata(message.content);
          const hasImage = imageMeta.length > 0;
          
          const id = `user_message:${row.id || Date.now()}`;
          if (!isSeen(id)) {
            addEvent(sessionKey, threadNumber, {
              type: "user_message",
              id,
              sessionId: sessionKey,
              timestamp: parseTimestamp(row.timestamp),
              data: {
                sender,
                preview: text,
                hasImage,
                imageMeta
              }
            });
            hasNewEvents = true;
          }
          
          // Track images separately
          if (hasImage) {
            for (const img of message.content) {
              if (img?.type === "image") {
                const imgData = img as { mimeType?: string; source?: { type?: string; data?: string; url?: string } };
                const imgId = `image:${row.id}:${imgData.mimeType || "unknown"}`;
                if (!isSeen(imgId)) {
                  let source = "";
                  if (imgData.source?.type === "base64") {
                    source = `base64:${String(imgData.source.data || "").slice(0, 20)}...`;
                  } else if (imgData.source?.url) {
                    source = imgData.source.url;
                  }
                  
                  addEvent(sessionKey, threadNumber, {
                    type: "image",
                    id: imgId,
                    sessionId: sessionKey,
                    timestamp: parseTimestamp(row.timestamp),
                    data: {
                      mimeType: imgData.mimeType,
                      source
                    }
                  });
                  hasNewEvents = true;
                }
              }
            }
          }
        }
        
        // Track assistant messages
        if (message.role === "assistant") {
          // Track thinking content
          if (Array.isArray(message.content)) {
            for (const item of message.content) {
              if (item?.type === "thinking" && item?.thinking) {
                const id = `thinking:${row.id}:${String(item.thinking).slice(0, 50)}`;
                if (!isSeen(id)) {
                  addEvent(sessionKey, threadNumber, {
                    type: "thinking",
                    id,
                    sessionId: sessionKey,
                    timestamp: parseTimestamp(row.timestamp),
                    data: { preview: item.thinking }
                  });
                  hasNewEvents = true;
                }
              }
              
              // Track tool calls
              if (item?.type === "toolCall") {
                const name = String(item.name || "");
                const args = item.arguments || {};
                const toolId = String(item.id || "").trim() || `${name}:${JSON.stringify(args).slice(0, 100)}`;
                
                if (!isSeen(toolId)) {
                  toolCallTimestamps.set(toolId, { timestamp: parseTimestamp(row.timestamp), sessionId: sessionKey });
                  
                  addEvent(sessionKey, threadNumber, {
                    type: "toolCall",
                    id: toolId,
                    sessionId: sessionKey,
                    timestamp: parseTimestamp(row.timestamp),
                    data: {
                      name,
                      args: args as Record<string, unknown>,
                      isError: false,
                      durationMs: null
                    }
                  });
                  hasNewEvents = true;
                }
              }
            }
          }
          
          // Track completion (stopReason === "stop")
          if (row?.message?.stopReason === "stop") {
            const id = `complete:${row.id || Date.now()}`;
            if (!isSeen(id)) {
              // Extract text content for preview
              let messagePreview = "";
              if (Array.isArray(message.content)) {
                const textItem = message.content.find((c: { type?: string }) => c.type === "text");
                messagePreview = textItem?.text || "";
              }
              
              addEvent(sessionKey, threadNumber, {
                type: "assistant_complete",
                id,
                sessionId: sessionKey,
                timestamp: parseTimestamp(row.timestamp),
                data: {
                  tokens: row.message.usage?.totalTokens,
                  stopReason: row.message.stopReason,
                  messagePreview
                }
              });
              hasNewEvents = true;
            }
          }
        }
        
        // Track tool results
        if (message.role === "toolResult") {
          const toolCallId = message.toolCallId;
          if (!toolCallId) continue;
          
          const callInfo = toolCallTimestamps.get(toolCallId);
          if (!callInfo) continue;
          
          // Find and update the pending tool call
          const events = pendingEvents.get(callInfo.sessionId);
          if (!events) continue;
          
          const toolEvent = events.find(e => e.id === toolCallId && e.type === "toolCall");
          if (!toolEvent) continue;
          
          const data = toolEvent.data;
          data.isError = message.isError === true;
          
          // Parse diff stats for edits
          if (message.details?.diff && (data.name === "edit" || data.name === "write")) {
            data.diffStats = parseDiffStats(message.details.diff);
          }
          
          const resultTs = parseTimestamp(row.timestamp);
          if (message.details?.durationMs) {
            data.durationMs = message.details.durationMs;
          } else if (resultTs && toolEvent.timestamp) {
            data.durationMs = resultTs - toolEvent.timestamp;
          }
        }
      } catch {}
    }
    
    state.offsets[filename] = newOffset;
    if (hasNewEvents) {
      saveState();
    }
  } catch {}
}

function scanAllFiles() {
  loadSessionsJson();
  
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filepath = join(SESSIONS_DIR, file);
      try {
        const content = readFileSync(filepath, "utf8");
        const lines = content.split("\n");
        const sessionKey = file.replace(".jsonl", "");
        const existing = sessionMetadata.get(sessionKey);
        let projectName = existing?.projectName || sessionKey;
        let cwd = existing?.cwd || "";
        const chatType = existing?.chatType || "unknown";
        const model = existing?.model || "";
        const key = existing?.key || "";
        const contextTokens = existing?.contextTokens;
        let usedTokens = existing?.usedTokens;
        const provider = existing?.provider;
        const surface = existing?.surface;
        const updatedAt = existing?.updatedAt;
        const groupId = existing?.groupId;
        let thinkingLevel = existing?.thinkingLevel;
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            if (row?.type === "session" && row?.cwd) {
              const parts = row.cwd.split("/");
              projectName = parts[parts.length - 1] || sessionKey;
              cwd = row.cwd;
            }
            if (row?.type === "thinking_level_change") {
              thinkingLevel = row.thinkingLevel;
            }
            if (row?.message?.usage?.totalTokens) {
              usedTokens = row.message.usage.totalTokens;
            }
          } catch {}
        }
        
        sessionMetadata.set(sessionKey, { cwd, projectName, model, chatType, key, contextTokens, usedTokens, provider, surface, updatedAt, groupId, thinkingLevel });
      } catch {}
      
      tailFile(file);
    }
  } catch {}
}

function cleanup() {
  isShuttingDown = true;
  try {
    state.seenIds = [...seenIdsSet];
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

mkdirSync(STATE_DIR, { recursive: true });
writePidFile();
loadState();
scanAllFiles();

const watcher = watch(SESSIONS_DIR, (event, filename) => {
  if (isShuttingDown) return;
  if (event === "change" && filename?.endsWith(".jsonl")) {
    tailFile(filename);
  }
});

watcher.on("error", (err) => {
  console.error("[discord-audit-stream] Watcher error:", err);
});

console.log(`[discord-audit-stream] Daemon running, PID: ${process.pid}`);
