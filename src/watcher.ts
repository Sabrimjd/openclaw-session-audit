/**
 * File watching and tailing logic
 */

import { createReadStream, existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AGENTS_DIR, MAX_FILE_SIZE } from "./config.js";
import { state, hasSeenId, hasBeenSeen } from "./state.js";
import { sessionMetadata, getBaseSessionId, getThreadNumber, loadSessionsJson } from "./metadata.js";
import { addEvent, pendingEvents, toolCallTimestamps } from "./events.js";
import { parseDiffStats, extractSenderName } from "./format.js";
import type { PendingEvent } from "./types.js";

function isValidSessionFile(filename: string): boolean {
  return /^[a-f0-9-]{36}(-topic-\d+)?\.jsonl$/.test(filename);
}

function discoverAgents(): string[] {
  try {
    const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

// Reload sessions.json for all agents to pick up new sessions
export function reloadAllSessionsJson(): void {
  const agents = discoverAgents();
  for (const agentName of agents) {
    loadSessionsJson(agentName);
  }
  console.error("[session-audit] Reloaded sessions.json for all agents");
}

export async function tailFile(filename: string, agentName: string): Promise<void> {
  if (!isValidSessionFile(filename)) return;
  const sessionsDir = join(AGENTS_DIR, agentName, "sessions");
  const filepath = join(sessionsDir, filename);

  // Use namespaced offset key to avoid conflicts between agents
  const offsetKey = `${agentName}:${filename}`;

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filepath);
    if (fileStat.size > MAX_FILE_SIZE) return;
  } catch {
    return;
  }

  // Skip history: for new files, start at end (unless DEBUG_PROCESS_ALL is set)
  const debugProcessAll = process.env.SESSION_AUDIT_DEBUG_PROCESS_ALL === "true";
  if (state.offsets[offsetKey] === undefined) {
    if (debugProcessAll) {
      state.offsets[offsetKey] = 0;  // Process from beginning for debugging
      console.error(`[session-audit] DEBUG: Processing file from beginning (DEBUG_PROCESS_ALL=true): ${filename}`);
    } else {
      state.offsets[offsetKey] = fileStat.size;  // Skip to end
    }
  }
  const offset = state.offsets[offsetKey];
  const baseSessionId = getBaseSessionId(filename);
  const threadNumber = getThreadNumber(filename);
  const sessionKey = baseSessionId;

  try {
    const stream = createReadStream(filepath, { start: offset, encoding: "utf8" });
    const rl = createInterface({ input: stream });
    let newOffset = offset;

    for await (const line of rl) {
      if (!line.trim()) continue;
      newOffset += Buffer.byteLength(line, "utf8") + 1;

      try {
        const row = JSON.parse(line);
        const rowType = row?.type;

        // Parse session metadata
        if (rowType === "session" && row?.cwd) {
          const parts = row.cwd.split("/");
          const projectName = parts[parts.length - 1] || sessionKey;
          const existing = sessionMetadata.get(sessionKey);
          if (existing) {
            existing.cwd = row.cwd;
            existing.projectName = projectName;
          } else {
            sessionMetadata.set(sessionKey, {
              cwd: row.cwd,
              projectName,
              model: "",
              chatType: "unknown",
              key: "",
            });
          }
        }

        // Track thinking level changes
        if (rowType === "thinking_level_change") {
          const level = row.thinkingLevel || "unknown";
          const existing = sessionMetadata.get(sessionKey);
          if (existing) existing.thinkingLevel = level;

          const id = `thinking_level:${row.id || Date.now()}`;
          if (!hasSeenId(id)) {
            addEvent(sessionKey, {
              type: "thinking_level",
              id,
              sessionKey,
              timestamp: new Date(row.timestamp).getTime(),
              data: { level },
              threadNumber: threadNumber || undefined,
            });
          }
        }

        // Track model changes
        if (rowType === "model_change" && row?.modelId) {
          const existing = sessionMetadata.get(sessionKey);
          const oldModel = existing?.model || "";
          const newModel = row.modelId;
          if (existing) existing.model = newModel;

          const id = `model_change:${row.id || Date.now()}`;
          if (!hasSeenId(id)) {
            addEvent(sessionKey, {
              type: "model_change",
              id,
              sessionKey,
              timestamp: new Date(row.timestamp).getTime(),
              data: { oldModel, newModel },
              threadNumber: threadNumber || undefined,
            });
          }
        }

        // Capture model-snapshot events (initial model at session start)
        if (rowType === "custom" && row?.customType === "model-snapshot" && row?.data?.modelId) {
          const existing = sessionMetadata.get(sessionKey);
          const newModel = row.data.modelId;
          if (existing && !existing.model) {
            existing.model = newModel;
          }
        }

        // Track errors
        if (rowType === "error" && (row?.error || row?.message)) {
          const errorMsg = row.error || row.message || "Unknown error";
          const id = `error:${row.id || Date.now()}:${String(errorMsg).slice(0, 50)}`;
          if (!hasSeenId(id)) {
            addEvent(sessionKey, {
              type: "error",
              id,
              sessionKey,
              timestamp: new Date(row.timestamp).getTime(),
              data: { error: String(errorMsg), message: String(errorMsg) },
              threadNumber: threadNumber || undefined,
            });
          }
        }

        // Track token usage
        if (row?.message?.usage?.totalTokens) {
          const existing = sessionMetadata.get(sessionKey);
          if (existing) {
            existing.usedTokens = row.message.usage.totalTokens;
          }
        }

        const message = row?.message;
        if (!message) continue;

        // Track user messages
        if (message.role === "user" && Array.isArray(message.content)) {
          const textItem = message.content.find((c: { type?: string }) => c.type === "text");
          let text = textItem?.text || "";

          // Extract actual user message from metadata-wrapped Discord messages
          const userTextMatch = text.match(/\[Image\]\s*User text:\s*([\s\S]+)/);
          if (userTextMatch) {
            text = userTextMatch[1].trim();
          } else if (text.includes("Conversation info (untrusted metadata)")) {
            const parts = text.split(/```/);
            if (parts.length > 1) {
              const lastPart = parts[parts.length - 1].trim();
              if (lastPart && !lastPart.includes("metadata") && lastPart !== "...." && lastPart.length > 5) {
                text = lastPart;
              } else {
                text = "";
              }
            } else {
              text = "";
            }
          }

          const sender = extractSenderName(message.content);

          const id = `user_message:${row.id || Date.now()}`;
          if (!hasSeenId(id)) {
            addEvent(sessionKey, {
              type: "user_message",
              id,
              sessionKey,
              timestamp: new Date(row.timestamp).getTime(),
              data: { sender, preview: text },
              threadNumber: threadNumber || undefined,
            });
          }
        }

        // Track assistant messages
        if (message.role === "assistant") {
          // Track thinking content
          if (Array.isArray(message.content)) {
            for (const item of message.content) {
              if (item?.type === "thinking" && (item as { thinking?: string }).thinking) {
                const thinking = (item as { thinking: string }).thinking;
                const id = `thinking:${row.id}:${thinking.slice(0, 50)}`;
                if (!hasSeenId(id)) {
                  if (process.env.SESSION_AUDIT_DEBUG) {
                    console.error(`[session-audit] DEBUG: Adding thinking event id=${id}`);
                  }
                  addEvent(sessionKey, {
                    type: "thinking",
                    id,
                    sessionKey,
                    timestamp: new Date(row.timestamp).getTime(),
                    data: { preview: thinking },
                    threadNumber: threadNumber || undefined,
                  });
                }
              }

              // Track tool calls
              if (item?.type === "toolCall") {
                const toolItem = item as { id?: string; name?: string; arguments?: Record<string, unknown> };
                const name = String(toolItem.name || "");
                const args = toolItem.arguments || {};
                const toolId = String(toolItem.id || "").trim() || `${name}:${JSON.stringify(args).slice(0, 100)}`;

                if (process.env.SESSION_AUDIT_DEBUG) {
                  console.error(`[session-audit] DEBUG: Found toolCall name=${name} id=${toolId} seen=${hasBeenSeen(toolId)}`);
                }
                if (!hasSeenId(toolId)) {
                  toolCallTimestamps.set(toolId, { timestamp: new Date(row.timestamp).getTime(), sessionKey });

                  addEvent(sessionKey, {
                    type: "toolCall",
                    id: toolId,
                    sessionKey,
                    timestamp: new Date(row.timestamp).getTime(),
                    data: {
                      name,
                      args,
                      isError: false,
                      durationMs: null,
                    },
                    threadNumber: threadNumber || undefined,
                  });
                }
              }
            }
          }

          // Track completion
          if (message.stopReason === "stop" || message.stopReason === "end_turn") {
            const id = `complete:${row.id || Date.now()}`;
            if (!hasSeenId(id)) {
              let messagePreview = "";
              if (Array.isArray(message.content)) {
                const textItem = message.content.find((c: { type?: string }) => c.type === "text");
                messagePreview = (textItem as { text?: string })?.text || "";
              }

              if (process.env.SESSION_AUDIT_DEBUG) {
                console.error(`[session-audit] DEBUG: Adding assistant_complete event id=${id} stopReason=${message.stopReason} tokens=${message.usage?.totalTokens}`);
              }
              addEvent(sessionKey, {
                type: "assistant_complete",
                id,
                sessionKey,
                timestamp: new Date(row.timestamp).getTime(),
                data: {
                  tokens: message.usage?.totalTokens,
                  stopReason: message.stopReason,
                  messagePreview,
                },
                threadNumber: threadNumber || undefined,
              });
            }
          }
        }

        // Track tool results - update existing tool call event
        if (message.role === "toolResult" && message.toolCallId) {
          const toolCallId = message.toolCallId;
          const callInfo = toolCallTimestamps.get(toolCallId);
          if (process.env.SESSION_AUDIT_DEBUG) {
            console.error(`[session-audit] DEBUG: toolResult for ${toolCallId}, found in timestamps=${!!callInfo}`);
          }
          if (callInfo) {
            // Find and update the pending tool call
            const groupKey = threadNumber ? `${sessionKey}-topic-${threadNumber}` : sessionKey;
            const events = pendingEvents.get(groupKey);
            if (events) {
              const toolEvent = events.find(e => e.id === toolCallId && (e.type === "toolCall" || e.type === "tool_call"));
              if (toolEvent) {
                const data = toolEvent.data;
                data.isError = message.isError === true;

                // Parse diff stats for edits
                if (message.details?.diff && (data.name === "edit" || data.name === "write")) {
                  data.diffStats = parseDiffStats(message.details.diff);
                }

                const resultTs = new Date(row.timestamp).getTime();
                if (message.details?.durationMs) {
                  data.durationMs = message.details.durationMs;
                } else if (resultTs && toolEvent.timestamp) {
                  data.durationMs = resultTs - toolEvent.timestamp;
                }
                if (process.env.SESSION_AUDIT_DEBUG) {
                  console.error(`[session-audit] DEBUG: Updated toolCall ${toolCallId} with duration=${data.durationMs}ms isError=${data.isError}`);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("[session-audit] Failed to parse line:", err);
      }
    }
    state.offsets[offsetKey] = newOffset;
  } catch (err) {
    console.error(`[session-audit] Error reading ${filename}:`, err);
  }
}

// Scan all files to build metadata before watching
export async function scanAllFiles(): Promise<void> {
  const agents = discoverAgents();
  console.error("[session-audit] Discovered agents:", agents.join(", "));

  for (const agentName of agents) {
    loadSessionsJson(agentName);

    const sessionsDir = join(AGENTS_DIR, agentName, "sessions");
    if (!existsSync(sessionsDir)) continue;

    try {
      const files = readdirSync(sessionsDir).filter((f: string) => isValidSessionFile(f));
      for (const file of files) {
        const filepath = join(sessionsDir, file);
        try {
          const content = readFileSync(filepath, "utf8");
          const lines = content.split("\n");
          const sessionKey = getBaseSessionId(file);
          const existing = sessionMetadata.get(sessionKey);
          let projectName = existing?.projectName || sessionKey.slice(0, 8);
          let cwd = existing?.cwd || "";
          const chatType = existing?.chatType || "unknown";
          let model = existing?.model || "";
          const key = existing?.key || "";
          const contextTokens = existing?.contextTokens;
          let usedTokens = existing?.usedTokens;
          const provider = existing?.provider;
          const surface = existing?.surface;
          const updatedAt = existing?.updatedAt;
          const groupId = existing?.groupId;
          let thinkingLevel = existing?.thinkingLevel;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const row = JSON.parse(line);
              if (row?.type === "session" && row?.cwd) {
                const parts = row.cwd.split("/");
                projectName = parts[parts.length - 1] || sessionKey;
                cwd = row.cwd;
              }
              if (row?.type === "thinking_level_change") {
                thinkingLevel = row.thinkingLevel;
              }
              if (row?.message?.usage?.totalTokens) {
                usedTokens = row.message.usage.totalTokens;
              }
              if (row?.type === "model_change" && row?.modelId) {
                model = row.modelId;
              }
              if (row?.type === "custom" && row?.customType === "model-snapshot" && row?.data?.modelId) {
                if (!model) model = row.data.modelId;
              }
            } catch (err) {
              console.error("[session-audit] Failed to parse line during scan:", err);
            }
          }

          sessionMetadata.set(sessionKey, {
            cwd,
            projectName,
            model,
            chatType,
            key,
            agentName,
            contextTokens,
            usedTokens,
            provider,
            surface,
            updatedAt,
            groupId,
            thinkingLevel
          });
        } catch (err) {
          console.error("[session-audit] Failed to read file during scan:", filepath, err);
        }

        // Tail the file for new events
        await tailFile(file, agentName);
      }
    } catch (err) {
      console.error(`[session-audit] Failed to scan files for agent ${agentName}:`, err);
    }
  }

  console.error("[session-audit] Total sessions loaded:", sessionMetadata.size);
}

export function startWatcher(): void {
  const agents = discoverAgents();
  let watchCount = 0;

  for (const agentName of agents) {
    const sessionsDir = join(AGENTS_DIR, agentName, "sessions");
    if (!existsSync(sessionsDir)) continue;

    try {
      const watcher = watch(sessionsDir, (_eventType: string, filename: string | null) => {
        if (filename && isValidSessionFile(filename)) {
          tailFile(filename, agentName).catch(console.error);
        }
      });
      watcher.on("error", (err: Error) => console.error(`[session-audit] Watcher error for ${agentName}:`, err));
      watchCount++;
    } catch (err) {
      console.error(`[session-audit] Failed to start watcher for ${agentName}:`, err);
    }
  }

  console.error(`[session-audit] Watching ${watchCount} agent session directories`);
}
