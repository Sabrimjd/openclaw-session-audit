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
const HEADER_TTL_MS = 3600000; // 1 hour

// Cleanup interval for stale headers
let headerCleanupInterval: NodeJS.Timeout | null = null;

function startHeaderCleanup(): void {
  if (!headerCleanupInterval) {
    headerCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, time] of lastHeaderTime) {
        if (now - time > HEADER_TTL_MS) {
          lastHeaderTime.delete(key);
        }
      }
    }, 300000); // Every 5 minutes
  }
}

startHeaderCleanup();

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
  const typeIcon = info.chatType === "direct" ? "👤" : info.chatType === "channel" ? "👥" : "";
  const subagentTag = info.isSubagent ? "[subagent]" : "";
  const threadTag = threadNumber ? ` [thread:${threadNumber}]` : "";

  const parts: string[] = [`${info.emoji}[${info.name}]${info.model}${subagentTag}${threadTag}`];
  const metaParts: string[] = [];
  const keyStr = info.keyDisplay || sessionKey.slice(0, 8);
  if (typeIcon) {
    metaParts.push(`${typeIcon}${keyStr}`);
  } else {
    metaParts.push(keyStr);
  }
  if (info.cwd) metaParts.push(`📁${info.cwd}`);
  if (info.contextTokens) metaParts.push(`📊${info.contextTokens}`);
  if (info.thinkingLevel) metaParts.push(`🧠${info.thinkingLevel}`);
  if (info.surface) metaParts.push(`🖥️${info.surface}`);
  if (info.provider) metaParts.push(`🔌${info.provider}`);
  if (info.updatedAt) metaParts.push(`⏰${info.updatedAt}`);
  if (info.groupId) metaParts.push(`🔗${info.groupId.slice(0, 8)}`);

  if (metaParts.length > 0) parts.push(metaParts.join(" | "));

  const header = parts.join(" ");

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

  for (const event of events) {
    const formatted = formatEvent(event);
    if (!formatted) continue; // Skip null results
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

  return lines.join("\n");
}

export function sendMessage(text: string): void {
  if (!CONFIG.channel || !CONFIG.targetId) {
    console.error("[session-audit] Missing channel or targetId");
    return;
  }

  const truncated = truncateText(text, MAX_MESSAGE_LENGTH);

  // spawn without shell:true is safe from command injection
  const child = spawn(OPENCLAW_BIN, [
    "message", "send", "--channel", CONFIG.channel,
    "--target", CONFIG.targetId, "--message", truncated, "--silent",
  ], { 
    stdio: "ignore",
    shell: false  // Explicit for security clarity
  });

  child.on("error", (err) => {
    console.error("[session-audit] Failed to send message:", err);
  });

  child.unref();
}
