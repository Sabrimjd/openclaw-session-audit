import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "state");
const PID_FILE = join(STATE_DIR, "daemon.pid");

interface PluginConfig {
  webhookUrl?: string;
  fallbackChannelId?: string;
  sendMethod?: "webhook" | "fallback" | "auto";
  rateLimitMs?: number;
  batchWindowMs?: number;
  maxBatchSize?: number;
  agentEmojis?: Record<string, string>;
}

function getConfig(api: OpenClawPluginApi): PluginConfig {
  const pluginConfig = api.config?.plugins?.entries?.["openclaw-discord-audit-stream"]?.config || {};
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
        api.logger.info(`[discord-audit-stream] Daemon already running, PID: ${pid}`);
        return;
      }
      unlinkSync(PID_FILE);
    } catch {}
  }

  const config = getConfig(api);
  const env: Record<string, string> = { ...process.env };
  
  if (config.webhookUrl) env.DISCORD_AUDIT_WEBHOOK_URL = config.webhookUrl;
  if (config.fallbackChannelId) env.DISCORD_AUDIT_CHANNEL_ID = config.fallbackChannelId;
  if (config.sendMethod) env.DISCORD_AUDIT_SEND_METHOD = config.sendMethod;
  if (config.rateLimitMs) env.DISCORD_AUDIT_RATE_LIMIT_MS = String(config.rateLimitMs);
  if (config.batchWindowMs) env.DISCORD_AUDIT_BATCH_WINDOW_MS = String(config.batchWindowMs);
  if (config.agentEmojis) env.DISCORD_AUDIT_AGENT_EMOJIS = JSON.stringify(config.agentEmojis);

  const child = spawn("node", [join(__dirname, "src", "daemon.ts")], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
    env,
  });

  child.unref();
  api.logger.info(`[discord-audit-stream] Started daemon, PID: ${child.pid}`);
}

function stopDaemon(logger: OpenClawPluginApi["logger"]) {
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessRunning(pid)) {
        process.kill(pid, "SIGTERM");
        logger.info(`[discord-audit-stream] Stopped daemon, PID: ${pid}`);
      }
      unlinkSync(PID_FILE);
    } catch {}
  }
}

const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    webhookUrl: {
      type: "string",
      description: "Discord webhook URL"
    },
    fallbackChannelId: {
      type: "string",
      description: "Fallback Discord channel ID"
    },
    sendMethod: {
      type: "string",
      enum: ["webhook", "fallback", "auto"],
      default: "auto",
      description: "Method to send messages: webhook, fallback (openclaw CLI), or auto"
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
  required: []
};

const uiHints = {
  webhookUrl: { label: "Discord Webhook URL", sensitive: true, placeholder: "https://discord.com/api/webhooks/..." },
  fallbackChannelId: { label: "Fallback Channel ID", placeholder: "1234567890" },
  sendMethod: { label: "Send Method" },
  rateLimitMs: { label: "Rate Limit (ms)" },
  batchWindowMs: { label: "Batch Window (ms)" },
  maxBatchSize: { label: "Max Batch Size" },
  agentEmojis: { label: "Agent Emojis" }
};

const plugin = {
  id: "openclaw-discord-audit-stream",
  name: "Discord Audit Stream",
  description: "Monitors OpenClaw session files and sends all events to a Discord channel",
  configSchema,
  uiHints,
  register(api: OpenClawPluginApi) {
    api.registerService({
      id: "openclaw-discord-audit-stream-daemon",
      start: () => startDaemon(api),
      stop: () => stopDaemon(api.logger),
    });
  },
};

export default plugin;
