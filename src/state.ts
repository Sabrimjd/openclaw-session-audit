/**
 * State management for offsets and seen IDs
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { STATE_DIR, STATE_FILE, PID_FILE, MAX_SEEN_IDS } from "./config.js";
import type { State } from "./types.js";

export let state: State = { offsets: {}, seenIds: [] };
export let seenIdsSet: Set<string> = new Set();

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

export function saveState(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    state.seenIds = [...seenIdsSet];
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[session-audit] Failed to save state:", err);
  }
}

export function hasSeenId(id: string): boolean {
  if (seenIdsSet.has(id)) return true;
  seenIdsSet.add(id);
  if (seenIdsSet.size > MAX_SEEN_IDS) {
    const arr = [...seenIdsSet].slice(-MAX_SEEN_IDS);
    seenIdsSet = new Set(arr);
  }
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

export function checkSingleInstance(): boolean {
  // The parent (index.ts) should have killed all daemons already
  // This is a safety check - clean up any stale PID file
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore errors
  }
  return true;
}
