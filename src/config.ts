/**
 * Configuration loading and constants
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { Config } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = dirname(__dirname);
export const AGENTS_DIR = homedir() + "/.openclaw/agents";
export const STATE_DIR = PROJECT_ROOT + "/state";
export const STATE_FILE = STATE_DIR + "/state.json";
export const PID_FILE = STATE_DIR + "/daemon.pid";

export const TOOL_ICONS: Record<string, string> = {
  exec: "⚡", edit: "✏️", write: "📝", read: "📖", glob: "🔍", grep: "🔎",
  webfetch: "🌐", web_fetch: "🌐", web_search: "🔎", bash: "💻", process: "⚙️",
  sessions_spawn: "🚀", sessions_list: "📋", sessions_history: "📜", sessions_send: "📤",
  delegate_task: "📤", subagents: "🤖", memory_search: "🧠", cron: "⏰",
  gateway: "🚪", browser: "🌐", image: "🖼️", nodes: "🔷", session_status: "📊",
  output: "📤", agents_list: "📋", message: "💬",
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

export function loadConfig(): Config {
  const defaults: Config = {
    channel: "",
    targetId: "",
    rateLimitMs: 2000,
    batchWindowMs: 10000,
    maxBatchSize: 15,
    maxMessageLength: 1700,
    maxFileSize: 10_000_000,
    maxSeenIds: 5000,
    agentEmojis: { clawd: "🦞" },
    headerIntervalMs: 60000
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
  if (process.env.SESSION_AUDIT_HEADER_INTERVAL_MS) {
    defaults.headerIntervalMs = parseInt(process.env.SESSION_AUDIT_HEADER_INTERVAL_MS, 10);
  }
  if (process.env.SESSION_AUDIT_AGENT_EMOJIS) {
    try {
      defaults.agentEmojis = JSON.parse(process.env.SESSION_AUDIT_AGENT_EMOJIS);
    } catch (err) {
      console.error("[session-audit] Failed to parse agent emojis:", err);
    }
  }

  return defaults;
}

export const CONFIG = loadConfig();
export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";

// Convenience constants
export const RATE_LIMIT_MS = CONFIG.rateLimitMs;
export const BATCH_WINDOW_MS = CONFIG.batchWindowMs;
export const MAX_BATCH_SIZE = CONFIG.maxBatchSize;
export const MAX_SEEN_IDS = CONFIG.maxSeenIds;
export const MAX_FILE_SIZE = CONFIG.maxFileSize;
export const MAX_MESSAGE_LENGTH = CONFIG.maxMessageLength;
export const HEADER_INTERVAL_MS = CONFIG.headerIntervalMs;
export const TOOL_PREVIEW_LENGTH = 250;

// Rate limiting
export let retryAfterMs = 0;
export function setRetryAfter(ms: number) { retryAfterMs = ms; }
export function getRetryAfter() { return retryAfterMs; }
