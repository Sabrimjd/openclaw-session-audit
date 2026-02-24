/**
 * Message building and sending
 */

import { spawn } from "node:child_process";
import { CONFIG, OPENCLAW_BIN, MAX_MESSAGE_LENGTH, HEADER_INTERVAL_MS } from "./config.js";
import { truncateText, formatEvent } from "./format.js";
import { getProjectInfo } from "./metadata.js";
import type { PendingEvent } from "./types.js";

// Track when each session last showed a header
const lastHeaderTime = new Map<string, number>();

export function buildMessage(groupKey: string, events: PendingEvent[]): string {
  let sessionKey = groupKey;
  let threadNumber: string | null = null;
  const threadMatch = groupKey.match(/^(.+)-topic-(\d+)$/);
  if (threadMatch) {
    sessionKey = threadMatch[1];
    threadNumber = threadMatch[2];
  }

  // Also check first event for thread number
  if (!threadNumber && events.length > 0 && events[0].threadNumber) {
    threadNumber = events[0].threadNumber;
  }

  const info = getProjectInfo(sessionKey);
  const subagentTag = info.isSubagent ? " [subagent]" : "";
  const threadTag = threadNumber ? ` [thread:${threadNumber}]` : "";

  // Build compact session type:action from key
  // e.g., "agent:main:cron:xxx:run:xxx" → "cron:run"
  // e.g., "agent:main:discord:channel:xxx" → "discord:channel"
  // e.g., "agent:main:subagent:uuid" → "subagent:uuid8"
  let sessionType = "";
  const keyParts = info.keyDisplay?.split(":") || [];
  if (keyParts.length >= 3) {
    const type = keyParts[2]; // cron, discord, telegram, main, subagent, etc.
    let action = keyParts[4] || keyParts[3] || ""; // run, channel, user, uuid, etc.
    
    // Truncate UUIDs and long numeric IDs to 8 chars
    if (/^[a-f0-9-]{20,}$/.test(action) || /^[0-9]{15,}$/.test(action)) {
      action = action.slice(0, 8);
    }
    
    if (type && type !== "main") {
      sessionType = action && action !== type ? `${type}:${action}` : type;
    }
  }

  // Extract percentage from tokens: "21k/262k (8%)" → "8%"
  const tokenMatch = info.contextTokens?.match(/\((\d+%)\)/);
  const tokenDisplay = tokenMatch ? `📊${tokenMatch[1]}` : "";

  // Build compact header: 🦞 clawd (model) cron:run · 📊8% · low · 14:36
  const metaParts: string[] = [];
  if (sessionType) metaParts.push(sessionType);
  if (tokenDisplay) metaParts.push(tokenDisplay);
  if (info.thinkingLevel && info.thinkingLevel !== "off") metaParts.push(info.thinkingLevel);
  if (info.updatedAt) metaParts.push(info.updatedAt);

  const header = `${info.emoji} ${info.name}${info.model}${subagentTag}${threadTag}${metaParts.length ? " · " : ""}${metaParts.join(" · ")}`;

  // Check if we should show the header (once per minute per session)
  const now = Date.now();
  const lastHeader = lastHeaderTime.get(groupKey) || 0;
  const showHeader = (now - lastHeader) >= HEADER_INTERVAL_MS;

  if (showHeader) {
    lastHeaderTime.set(groupKey, now);
  }

  const lines: string[] = [];
  let totalLen = 0;

  if (showHeader) {
    lines.push(header);
    totalLen = header.length + 1;
  }

  let skippedCount = 0;
  for (const event of events) {
    const formatted = formatEvent(event);
    if (!formatted) {
      skippedCount++;
      continue; // Skip null results
    }
    if (totalLen + formatted.length + 1 > MAX_MESSAGE_LENGTH - 50) {
      const remaining = events.length - lines.length + 1;
      if (remaining > 0) {
        lines.push(`• … +${remaining} more`);
      }
      break;
    }
    lines.push(formatted);
    totalLen += formatted.length + 1;
  }

  if (skippedCount > 0) {
    console.error(`[session-audit] DEBUG: buildMessage skipped ${skippedCount} null events`);
  }
  if (process.env.SESSION_AUDIT_DEBUG) {
    console.error(`[session-audit] DEBUG: buildMessage output ${lines.length} lines from ${events.length} events`);
  }

  return lines.join("\n");
}

export function sendMessage(text: string): void {
  if (!CONFIG.channel || !CONFIG.targetId) {
    console.error("[session-audit] Missing channel or targetId");
    return;
  }

  const truncated = truncateText(text, MAX_MESSAGE_LENGTH);
  if (process.env.SESSION_AUDIT_DEBUG) {
    console.error(`[session-audit] DEBUG: sendMessage channel=${CONFIG.channel} target=${CONFIG.targetId} length=${truncated.length}`);
  }

  const child = spawn(OPENCLAW_BIN, [
    "message", "send", "--channel", CONFIG.channel,
    "--target", CONFIG.targetId, "--message", truncated, "--silent",
  ], { stdio: "ignore" });

  child.unref();
}
