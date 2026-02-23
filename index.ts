import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function readPidFile(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (!isNaN(pid) && pid > 0) {
        return pid;
      }
    }
  } catch {
    // Ignore errors reading PID file
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killDaemonByPid(): boolean {
  const pid = readPidFile();
  if (pid === null) {
    return false;
  }
  
  if (!isProcessRunning(pid)) {
    // Stale PID file - clean it up
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
  
  try {
    // Try graceful shutdown first
    process.kill(pid, "SIGTERM");
    
    // Wait briefly for graceful shutdown
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts && isProcessRunning(pid)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      attempts++;
    }
    
    // If still running, force kill
    if (isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
    }
    
    return true;
  } catch {
    return false;
  } finally {
    // Clean up PID file
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function startDaemon(api: OpenClawPluginApi) {
  ensureStateDir();

  // Kill existing daemon by PID (not by pkill pattern)
  killDaemonByPid();

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

  // Use tsx to run TypeScript directly with ESM support
  // IMPORTANT: shell: false is required for security (prevents command injection)
  const child = spawn("npx", ["tsx", join(__dirname, "src", "index.ts")], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
    env,
    shell: false,
  });

  child.unref();
  api.logger.info(`[session-audit] Started daemon, PID: ${child.pid}`);
}

function stopDaemon(logger: OpenClawPluginApi["logger"]) {
  const killed = killDaemonByPid();
  if (killed) {
    logger.info(`[session-audit] Stopped daemon process`);
  } else {
    logger.info(`[session-audit] No daemon process found`);
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
