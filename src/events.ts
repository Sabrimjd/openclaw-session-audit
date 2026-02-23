/**
 * Event batching and processing
 */

import { RATE_LIMIT_MS, BATCH_WINDOW_MS, MAX_BATCH_SIZE, getRetryAfter } from "./config.js";
import type { PendingEvent, ToolCallTimestamp } from "./types.js";

export const pendingEvents = new Map<string, PendingEvent[]>();
export const batchTimers = new Map<string, NodeJS.Timeout>();
export const toolCallTimestamps = new Map<string, ToolCallTimestamp>();

// Track last event time per group for cleanup
const lastEventTime = new Map<string, number>();
const EVENT_TTL_MS = 3600000; // 1 hour

// Cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;

// Import these dynamically to avoid circular dependency
// These are set by setMessageFunctions() called from main
let _buildMessage: ((groupKey: string, events: PendingEvent[]) => string) | null = null;
let _sendMessage: ((text: string) => void) | null = null;

export function setMessageFunctions(
  buildMessage: (groupKey: string, events: PendingEvent[]) => string,
  sendMessage: (text: string) => void
): void {
  _buildMessage = buildMessage;
  _sendMessage = sendMessage;
  
  // Start cleanup interval
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupStaleData, 300000); // Every 5 minutes
  }
}

async function flushEvents(groupKey: string): Promise<void> {
  const events = pendingEvents.get(groupKey);
  if (!events || events.length === 0) {
    pendingEvents.delete(groupKey);
    batchTimers.delete(groupKey);
    return;
  }
  pendingEvents.delete(groupKey);
  batchTimers.delete(groupKey);

  if (Date.now() < getRetryAfter()) {
    if (process.env.SESSION_AUDIT_DEBUG) {
      console.error(`[session-audit] DEBUG: flushEvents SKIPPED (rate limited) groupKey=${groupKey} events=${events.length}`);
    }
    return;
  }
  
  if (!_buildMessage || !_sendMessage) {
    console.error("[session-audit] Message functions not initialized");
    return;
  }

  if (process.env.SESSION_AUDIT_DEBUG) {
    console.error(`[session-audit] DEBUG: flushEvents groupKey=${groupKey} events=${events.length} types=${events.map(e => e.type).join(',')}`);
  }
  const message = _buildMessage(groupKey, events);
  if (process.env.SESSION_AUDIT_DEBUG) {
    console.error(`[session-audit] DEBUG: SENDING MESSAGE (${message.length} chars):\n${message.slice(0, 500)}...`);
  }
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  _sendMessage(message);
}

function scheduleFlush(groupKey: string): void {
  const events = pendingEvents.get(groupKey) || [];
  if (events.length >= MAX_BATCH_SIZE) {
    // Clear existing timer before manual flush to prevent race condition
    const existingTimer = batchTimers.get(groupKey);
    if (existingTimer) clearTimeout(existingTimer);
    batchTimers.delete(groupKey);
    flushEvents(groupKey).catch(console.error);
    return;
  }
  if (batchTimers.has(groupKey)) return;
  const timer = setTimeout(() => {
    flushEvents(groupKey).catch(console.error);
  }, BATCH_WINDOW_MS);
  batchTimers.set(groupKey, timer);
}

export function addEvent(sessionKey: string, event: PendingEvent): void {
  const groupKey = event.threadNumber
    ? `${sessionKey}-topic-${event.threadNumber}`
    : sessionKey;
  if (!pendingEvents.has(groupKey)) {
    pendingEvents.set(groupKey, []);
  }
  pendingEvents.get(groupKey)!.push(event);
  
  // Track last event time for cleanup
  lastEventTime.set(groupKey, Date.now());
  
  if (process.env.SESSION_AUDIT_DEBUG) {
    console.error(`[session-audit] DEBUG: addEvent type=${event.type} id=${event.id} groupKey=${groupKey} batch size=${pendingEvents.get(groupKey)!.length}`);
  }
  
  scheduleFlush(groupKey);
}

export async function flushAllBatches(): Promise<void> {
  const flushPromises: Promise<void>[] = [];
  
  for (const [groupKey, timer] of batchTimers) {
    clearTimeout(timer);
    flushPromises.push(flushEvents(groupKey));
  }
  batchTimers.clear();
  
  await Promise.all(flushPromises);
}

function cleanupStaleData(): void {
  const now = Date.now();
  
  // Cleanup stale pending events
  for (const [groupKey, lastTime] of lastEventTime) {
    if (now - lastTime > EVENT_TTL_MS) {
      pendingEvents.delete(groupKey);
      lastEventTime.delete(groupKey);
      const timer = batchTimers.get(groupKey);
      if (timer) {
        clearTimeout(timer);
        batchTimers.delete(groupKey);
      }
    }
  }
  
  // Cleanup old toolCallTimestamps (keep last 1000)
  if (toolCallTimestamps.size > 1000) {
    const entries = [...toolCallTimestamps.entries()];
    const toKeep = entries.slice(-1000);
    toolCallTimestamps.clear();
    for (const [key, value] of toKeep) {
      toolCallTimestamps.set(key, value);
    }
  }
  
  console.error(`[session-audit] Cleanup complete: ${pendingEvents.size} pending groups, ${toolCallTimestamps.size} tool call timestamps`);
}
