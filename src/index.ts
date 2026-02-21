/**
 * Main entry point for session-audit daemon
 */

import { CONFIG } from "./config.js";
import { loadState, checkSingleInstance, writePidFile, saveState } from "./state.js";
import { scanAllFiles, startWatcher } from "./watcher.js";
import { setMessageFunctions } from "./events.js";
import { buildMessage, sendMessage } from "./message.js";

// Wire up message functions for events module
setMessageFunctions(buildMessage, sendMessage);

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

  // Scan all files and start watching
  await scanAllFiles();
  startWatcher();

  // Save state periodically
  setInterval(saveState, 30000);
}

main().catch(console.error);
