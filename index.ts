import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "state");
const PID_FILE = join(STATE_DIR, "daemon.pid");

interface PluginConfig {
  channel: string;
  targetId: string;
  rateLimitMs?: number;
  batchWindowMs?: number;
  maxBatchSize?: number;
  agentEmojis?: Record<string, string>;
}

function getConfig(api: OpenClawPluginApi): PluginConfig {
  const pluginConfig = api.config?.plugins?.entries?.["openclaw-session-audit"]?.config || {};
  return pluginConfig as PluginConfig;
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function killAllDaemons(): void {
  try {
    // Use pkill to kill all session-audit daemon processes
    // This ensures we don't have orphaned daemons running
    execSync('pkill -f "tsx.*session-audit.*index.ts" 2>/dev/null || true');
  } catch {
    // Ignore errors if no processes found
  }
}

function startDaemon(api: OpenClawPluginApi) {
  ensureStateDir();

  // Kill ALL existing daemon processes first to prevent duplicates
  killAllDaemons();

  // Clean up PID file
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch {}
  }

  const config = getConfig(api);

  if (!config.channel || !config.targetId) {
    api.logger.warn(`[session-audit] Missing required config: channel and targetId`);
    return;
  }

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env.SESSION_AUDIT_CHANNEL = config.channel;
  env.SESSION_AUDIT_TARGET_ID = config.targetId;
  if (config.rateLimitMs) env.SESSION_AUDIT_RATE_LIMIT_MS = String(config.rateLimitMs);
  if (config.batchWindowMs) env.SESSION_AUDIT_BATCH_WINDOW_MS = String(config.batchWindowMs);
  if (config.agentEmojis) env.SESSION_AUDIT_AGENT_EMOJIS = JSON.stringify(config.agentEmojis);
  // Debug mode can be enabled via environment variable
  // env.SESSION_AUDIT_DEBUG_PROCESS_ALL = "true";

  // Log file for daemon output
  const logFile = join(STATE_DIR, "daemon.log");
  const fs = require("fs");
  const logOut = fs.openSync(logFile, "a");
  const logErr = fs.openSync(logFile, "a");

  // Use tsx to run TypeScript directly with ESM support
  const child = spawn("npx", ["tsx", join(__dirname, "src", "index.ts")], {
    detached: true,
    stdio: ["ignore", logOut, logErr],
    cwd: __dirname,
    env,
    shell: true,
  });

  child.unref();
  api.logger.info(`[session-audit] Started daemon, PID: ${child.pid}, logs: ${logFile}`);
}

function stopDaemon(logger: OpenClawPluginApi["logger"]) {
  // Kill all daemon processes using pkill for consistency
  killAllDaemons();
  logger.info(`[session-audit] Stopped all daemon processes`);

  // Clean up PID file
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch {}
  }
}

const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    channel: {
      type: "string",
      description: "OpenClaw channel name (discord, telegram, slack, etc.)"
    },
    targetId: {
      type: "string",
      description: "Target ID (channel, group, or user ID)"
    },
    rateLimitMs: {
      type: "number",
      default: 2000,
      description: "Rate limit between messages (ms)"
    },
    batchWindowMs: {
      type: "number",
      default: 8000,
      description: "Batch window for grouping events (ms)"
    },
    maxBatchSize: {
      type: "number",
      default: 15,
      description: "Maximum batch size"
    },
    agentEmojis: {
      type: "object",
      default: { clawd: "🦞" },
      description: "Emoji mappings for agents"
    }
  },
  required: ["channel", "targetId"]
};

const uiHints = {
  channel: { label: "Channel", placeholder: "discord, telegram, slack..." },
  targetId: { label: "Target ID", placeholder: "1234567890" },
  rateLimitMs: { label: "Rate Limit (ms)" },
  batchWindowMs: { label: "Batch Window (ms)" },
  maxBatchSize: { label: "Max Batch Size" },
  agentEmojis: { label: "Agent Emojis" }
};

const plugin = {
  id: "openclaw-session-audit",
  name: "Session Audit",
  description: "Monitor OpenClaw sessions and stream events to any channel",
  configSchema,
  uiHints,
  register(api: OpenClawPluginApi) {
    api.registerService({
      id: "openclaw-session-audit-daemon",
      start: () => startDaemon(api),
      stop: () => stopDaemon(api.logger),
    });
  },
};

export default plugin;
