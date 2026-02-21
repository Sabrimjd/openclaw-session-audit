/**
 * Event batching and processing
 */

import { RATE_LIMIT_MS, BATCH_WINDOW_MS, MAX_BATCH_SIZE, getRetryAfter } from "./config.js";
import type { PendingEvent, ToolCallTimestamp } from "./types.js";

export const pendingEvents = new Map<string, PendingEvent[]>();
export const batchTimers = new Map<string, NodeJS.Timeout>();
export const toolCallTimestamps = new Map<string, ToolCallTimestamp>();

// Import these dynamically to avoid circular dependency
let _buildMessage: (groupKey: string, events: PendingEvent[]) => string;
let _sendMessage: (text: string) => void;

export function setMessageFunctions(
  buildMessage: (groupKey: string, events: PendingEvent[]) => string,
  sendMessage: (text: string) => void
): void {
  _buildMessage = buildMessage;
  _sendMessage = sendMessage;
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

  if (Date.now() < getRetryAfter()) return;

  const message = _buildMessage(groupKey, events);
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  _sendMessage(message);
}

function scheduleFlush(groupKey: string): void {
  if (batchTimers.has(groupKey)) return;
  const events = pendingEvents.get(groupKey) || [];
  if (events.length >= MAX_BATCH_SIZE) {
    flushEvents(groupKey).catch(console.error);
    return;
  }
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
  scheduleFlush(groupKey);
}
