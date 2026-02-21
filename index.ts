import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startDaemon(api: OpenClawPluginApi) {
  ensureStateDir();
  
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessRunning(pid)) {
        api.logger.info(`[session-audit] Daemon already running, PID: ${pid}`);
        return;
      }
      unlinkSync(PID_FILE);
    } catch {}
  }

  const config = getConfig(api);
  
  if (!config.channel || !config.targetId) {
    api.logger.warn(`[session-audit] Missing required config: channel and targetId`);
    return;
  }

  const env: Record<string, string> = { ...process.env };
  env.SESSION_AUDIT_CHANNEL = config.channel;
  env.SESSION_AUDIT_TARGET_ID = config.targetId;
  if (config.rateLimitMs) env.SESSION_AUDIT_RATE_LIMIT_MS = String(config.rateLimitMs);
  if (config.batchWindowMs) env.SESSION_AUDIT_BATCH_WINDOW_MS = String(config.batchWindowMs);
  if (config.agentEmojis) env.SESSION_AUDIT_AGENT_EMOJIS = JSON.stringify(config.agentEmojis);

  const child = spawn("node", [join(__dirname, "src", "daemon.ts")], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
    env,
  });

  child.unref();
  api.logger.info(`[session-audit] Started daemon, PID: ${child.pid}`);
}

function stopDaemon(logger: OpenClawPluginApi["logger"]) {
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessRunning(pid)) {
        process.kill(pid, "SIGTERM");
        logger.info(`[session-audit] Stopped daemon, PID: ${pid}`);
      }
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
      description: "Rate limit in milliseconds"
    },
    batchWindowMs: {
      type: "number",
      default: 8000,
      description: "Batch window in milliseconds"
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
  description: "Monitors OpenClaw sessions and streams events to any channel",
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
