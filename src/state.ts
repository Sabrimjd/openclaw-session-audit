/**
 * State management for offsets and seen IDs
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { STATE_DIR, STATE_FILE, PID_FILE, MAX_SEEN_IDS } from "./config.js";
import type { State } from "./types.js";

export let state: State = { offsets: {}, seenIds: [] };
export let seenIdsSet: Set<string> = new Set();

// Mutex for state operations
let stateLock = false;
const stateQueue: (() => void)[] = [];

function acquireLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!stateLock) {
      stateLock = true;
      resolve();
    } else {
      stateQueue.push(() => resolve());
    }
  });
}

function releaseLock(): void {
  const next = stateQueue.shift();
  if (next) {
    next();
  } else {
    stateLock = false;
  }
}

export function loadState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      state = { offsets: data.offsets || {}, seenIds: data.seenIds || [] };
      seenIdsSet = new Set(state.seenIds);
      console.error("[session-audit] Loaded state with", state.seenIds.length, "seen IDs");
    }
  } catch (err) {
    console.error("[session-audit] Failed to load state:", err);
  }
}

export async function saveStateAtomic(): Promise<void> {
  await acquireLock();
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const tempFile = STATE_FILE + ".tmp";
    state.seenIds = [...seenIdsSet];
    writeFileSync(tempFile, JSON.stringify(state, null, 2));
    // Atomic rename
    renameSync(tempFile, STATE_FILE);
  } catch (err) {
    console.error("[session-audit] Failed to save state:", err);
  } finally {
    releaseLock();
  }
}

export function saveState(): void {
  // Atomic write pattern: write to temp file, then rename
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const tempFile = STATE_FILE + ".tmp";
    state.seenIds = [...seenIdsSet];
    writeFileSync(tempFile, JSON.stringify(state, null, 2));
    renameSync(tempFile, STATE_FILE);
  } catch (err) {
    console.error("[session-audit] Failed to save state:", err);
  }
}

export function hasBeenSeen(id: string): boolean {
  return seenIdsSet.has(id);
}

export function markAsSeen(id: string): void {
  seenIdsSet.add(id);
  if (seenIdsSet.size > MAX_SEEN_IDS) {
    const arr = [...seenIdsSet].slice(-MAX_SEEN_IDS);
    seenIdsSet = new Set(arr);
  }
}

export function hasSeenId(id: string): boolean {
  if (seenIdsSet.has(id)) {
    if (process.env.SESSION_AUDIT_DEBUG) {
      console.error(`[session-audit] DEBUG: hasSeenId DUPLICATE id=${id}`);
    }
    return true;
  }
  markAsSeen(id);
  return false;
}

export function writePidFile(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
  } catch (err) {
    console.error("[session-audit] Failed to write PID file:", err);
  }
}

export function readPidFile(): number | null {
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

export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function checkSingleInstance(): boolean {
  const existingPid = readPidFile();
  
  if (existingPid !== null) {
    if (isProcessRunning(existingPid)) {
      console.error(`[session-audit] Another instance is already running (PID: ${existingPid}), exiting`);
      return false;
    }
    // Stale PID file from dead process
    console.error(`[session-audit] Stale PID file found (PID: ${existingPid} not running), cleaning up`);
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore cleanup errors
    }
  }
  
  return true;
}
