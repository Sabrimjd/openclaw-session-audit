/**
 * Session metadata management
 */

import { existsSync, readFileSync } from "node:fs";
import { SESSIONS_JSON, CONFIG } from "./config.js";
import { formatTimeOnly } from "./format.js";
import type { SessionMetadata, ProjectInfo } from "./types.js";

export const sessionMetadata = new Map<string, SessionMetadata>();

export function loadSessionsJson(): void {
  try {
    if (!existsSync(SESSIONS_JSON)) return;
    const data = JSON.parse(readFileSync(SESSIONS_JSON, "utf8"));

    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== "object") continue;
      const sessionData = value as Record<string, unknown>;
      const sessionId = typeof sessionData.sessionId === "string" ? sessionData.sessionId : undefined;
      const updatedAt = typeof sessionData.updatedAt === "number" ? sessionData.updatedAt : undefined;
      const contextTokens = typeof sessionData.contextTokens === "number" ? sessionData.contextTokens : undefined;

      if (sessionId) {
        // Parse key format: agent:<agent>:<surface>:<type>:<id>
        const parts = key.split(":");
        const existing = sessionMetadata.get(sessionId);

        let surface = "";
        let chatType = "unknown";
        let groupId = "";

        if (parts.length >= 4) {
          surface = parts[2] || "";
          chatType = parts[3] || "unknown";
          groupId = parts[4] || "";
        } else if (parts.length === 3) {
          surface = parts[2] || "";
          chatType = "direct";
        }

        const formattedUpdatedAt = updatedAt
          ? formatTimeOnly(updatedAt)
          : "";

        if (existing) {
          // Update existing entry
          existing.chatType = chatType;
          existing.key = key;
          existing.surface = surface;
          existing.updatedAt = formattedUpdatedAt;
          existing.groupId = groupId;
          if (contextTokens) existing.contextTokens = contextTokens;
        } else {
          sessionMetadata.set(sessionId, {
            cwd: "",
            projectName: sessionId.slice(0, 8),
            model: "",
            chatType,
            key,
            contextTokens: contextTokens,
            provider: undefined,
            surface,
            updatedAt: formattedUpdatedAt,
            groupId,
            thinkingLevel: undefined,
          });
        }
      }
    }
    console.error("[session-audit] Loaded", sessionMetadata.size, "sessions from sessions.json");
  } catch (err) {
    console.error("[session-audit] Failed to load sessions.json:", err);
  }
}

export function getBaseSessionId(filename: string): string {
  const match = filename.match(/^([a-f0-9-]{36})(?:-topic-\d+)?\.jsonl$/);
  return match ? match[1] : filename.replace(/\.jsonl$/, "");
}

export function getThreadNumber(filename: string): string | null {
  const match = filename.match(/-topic-(\d+)\.jsonl$/);
  return match ? match[1] : null;
}

export function getProjectInfo(sessionId: string): ProjectInfo {
  const meta = sessionMetadata.get(sessionId);
  const shortId = sessionId.slice(0, 8);

  if (!meta) {
    return {
      name: shortId,
      emoji: "🤖",
      model: "",
      chatType: "unknown",
      shortId,
      keyDisplay: shortId,
      isSubagent: false,
      cwd: "",
      contextTokens: "",
      provider: "",
      surface: "",
      updatedAt: "",
      groupId: "",
      thinkingLevel: ""
    };
  }

  const parts = meta.cwd?.split("/") || [];
  let projectName = parts[parts.length - 1] || shortId;
  if (projectName === "home" && parts.length > 2) projectName = parts[parts.length - 2];

  const isSubagent = meta.key?.includes("subag") || false;
  const keyDisplay = meta.key || shortId;
  const emoji = CONFIG.agentEmojis[projectName] || "🤖";

  let contextTokens = "";
  if (meta.usedTokens && meta.contextTokens) {
    const pct = Math.round((meta.usedTokens / meta.contextTokens) * 100);
    contextTokens = `${Math.round(meta.usedTokens / 1000)}k/${Math.round(meta.contextTokens / 1000)}k (${pct}%)`;
  } else if (meta.contextTokens) {
    contextTokens = `${Math.round(meta.contextTokens / 1000)}k`;
  }

  return {
    name: projectName,
    emoji,
    model: meta.model ? ` (${meta.model.split("/").pop()})` : "",
    chatType: meta.chatType || "unknown",
    shortId,
    keyDisplay,
    isSubagent,
    cwd: meta.cwd || "",
    contextTokens,
    provider: meta.provider || "",
    surface: meta.surface || "",
    updatedAt: meta.updatedAt || "",
    groupId: meta.groupId || "",
    thinkingLevel: meta.thinkingLevel || ""
  };
}
