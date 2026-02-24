import { appendFileSync, statSync, renameSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, LOG_MAX_SIZE_MB, LOG_MAX_ARG_LENGTH } from "./config.js";
import type { SessionMetadata } from "./types.js";

export interface LoggedSession {
  id: string;
  name: string;
  model: string;
  chatType: string;
  surface: string;
  groupId: string;
  cwd: string;
  tokens: { used: number; context: number; percent: number } | null;
  thinkingLevel: string;
  isSubagent: boolean;
  threadNumber: string | null;
  agentName: string;
}

export interface LoggedEvent {
  id: string;
  timestamp: number;
  type: string;
  session: LoggedSession;
  data: Record<string, unknown>;
}

const LOG_PATH = join(STATE_DIR, "events.jsonl");

export function buildSessionInfo(
  sessionKey: string,
  metadata: SessionMetadata | undefined,
  threadNumber: string | null
): LoggedSession {
  const shortId = sessionKey.slice(0, 8);
  
  let tokens: { used: number; context: number; percent: number } | null = null;
  if (metadata?.usedTokens && metadata?.contextTokens) {
    const percent = Math.round((metadata.usedTokens / metadata.contextTokens) * 100);
    tokens = { used: metadata.usedTokens, context: metadata.contextTokens, percent };
  }

  return {
    id: sessionKey,
    name: metadata?.projectName || shortId,
    model: metadata?.model || "",
    chatType: metadata?.chatType || "unknown",
    surface: metadata?.surface || "",
    groupId: metadata?.groupId || "",
    cwd: metadata?.cwd || "",
    tokens,
    thinkingLevel: metadata?.thinkingLevel || "off",
    isSubagent: metadata?.key?.includes("subag") || false,
    threadNumber,
    agentName: metadata?.agentName || "",
  };
}

export function logEvent(event: LoggedEvent): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }

    const truncatedData = truncateArgs(event.data, LOG_MAX_ARG_LENGTH);
    const truncatedEvent = { ...event, data: truncatedData };

    const line = JSON.stringify(truncatedEvent) + "\n";
    appendFileSync(LOG_PATH, line, "utf8");

    rotateIfNeeded();
  } catch (err) {
    console.error("[session-audit] Failed to log event:", err);
  }
}

function truncateArgs(data: Record<string, unknown>, maxLength: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.length > maxLength) {
      result[key] = value.slice(0, maxLength) + "...[truncated]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = truncateArgs(value as Record<string, unknown>, maxLength);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => 
        typeof item === "string" && item.length > maxLength 
          ? item.slice(0, maxLength) + "...[truncated]"
          : item
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(LOG_PATH)) return;
    
    const stats = statSync(LOG_PATH);
    const sizeMb = stats.size / (1024 * 1024);

    if (sizeMb >= LOG_MAX_SIZE_MB) {
      // Delete oldest (events.5.jsonl)
      const oldest = join(STATE_DIR, "events.5.jsonl");
      if (existsSync(oldest)) {
        unlinkSync(oldest);
      }

      // Rotate: events.4 → events.5, events.3 → events.4, etc.
      for (let i = 4; i >= 1; i--) {
        const oldPath = join(STATE_DIR, `events.${i}.jsonl`);
        const newPath = join(STATE_DIR, `events.${i + 1}.jsonl`);
        if (existsSync(oldPath)) {
          renameSync(oldPath, newPath);
        }
      }

      // Current → events.1.jsonl
      renameSync(LOG_PATH, join(STATE_DIR, "events.1.jsonl"));
    }
  } catch {
    // Ignore rotation errors
  }
}
