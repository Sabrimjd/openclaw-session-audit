/**
 * Main entry point for session-audit daemon
 */

import { CONFIG } from "./config.js";
import { loadState, checkSingleInstance, writePidFile, saveState, saveStateAtomic } from "./state.js";
import { scanAllFiles, startWatcher, stopWatcher, reloadAllSessionsJson } from "./watcher.js";
import { setMessageFunctions, flushAllBatches } from "./events.js";
import { buildMessage, sendMessage } from "./message.js";

// Wire up message functions for events module
setMessageFunctions(buildMessage, sendMessage);

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  
  console.error(`[session-audit] Received ${signal}, shutting down gracefully...`);
  
  try {
    // 1. Stop watching for new events
    stopWatcher();
    
    // 2. Flush all pending events
    await flushAllBatches();
    
    // 3. Save state atomically
    await saveStateAtomic();
    
    console.error("[session-audit] Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("[session-audit] Error during shutdown:", err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.error("[session-audit] Starting daemon...");
  console.error("[session-audit] Config - channel:", CONFIG.channel, "targetId:", CONFIG.targetId);

  if (!CONFIG.channel || !CONFIG.targetId) {
    console.error("[session-audit] ERROR: Missing channel or targetId.");
    process.exit(1);
  }

  if (!checkSingleInstance()) {
    process.exit(1);
  }

  writePidFile();
  loadState();

  // Register signal handlers for graceful shutdown
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  
  // Handle uncaught errors
  process.on("uncaughtException", (err) => {
    console.error("[session-audit] Uncaught exception:", err);
    gracefulShutdown("uncaughtException").catch(() => process.exit(1));
  });
  
  process.on("unhandledRejection", (reason) => {
    console.error("[session-audit] Unhandled rejection:", reason);
  });

  // Scan all files and start watching
  try {
    await scanAllFiles();
    startWatcher();
  } catch (err) {
    console.error("[session-audit] Failed to initialize:", err);
    process.exit(1);
  }

  // Save state and reload sessions.json periodically
  setInterval(saveState, 30000);
  setInterval(reloadAllSessionsJson, 30000);
}

main().catch((err) => {
  console.error("[session-audit] Fatal error:", err);
  process.exit(1);
});
