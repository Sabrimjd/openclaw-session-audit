import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(__dirname, "state", "daemon.pid");

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const handler = async () => {
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
      if (isProcessRunning(pid)) {
        console.log(`[discord-audit-stream] Already running, PID: ${pid}`);
        return;
      }
      unlinkSync(PID_FILE);
    } catch {}
  }

  const child = spawn("node", [join(__dirname, "daemon.ts")], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
  });

  child.unref();
  console.log(`[discord-audit-stream] Started daemon, PID: ${child.pid}`);
};

export default handler;
