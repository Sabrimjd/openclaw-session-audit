import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "state");
const PID_FILE = join(STATE_DIR, "daemon.pid");

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

function startDaemon(logger: OpenClawPluginApi["logger"]) {
  ensureStateDir();
  
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessRunning(pid)) {
        logger.info(`[discord-audit-stream] Daemon already running, PID: ${pid}`);
        return;
      }
      unlinkSync(PID_FILE);
    } catch {}
  }

  const child = spawn("node", [join(__dirname, "src", "daemon.ts")], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
  });

  child.unref();
  logger.info(`[discord-audit-stream] Started daemon, PID: ${child.pid}`);
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

const plugin = {
  id: "discord-audit-stream",
  name: "Discord Audit Stream",
  description: "Monitors OpenClaw session files and sends all events to a Discord channel",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerService({
      id: "discord-audit-stream-daemon",
      start: () => startDaemon(api.logger),
      stop: () => stopDaemon(api.logger),
    });
  },
};

export default plugin;
