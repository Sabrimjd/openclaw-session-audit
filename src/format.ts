/**
 * Formatting utilities
 */

import { TOOL_ICONS, TOOL_PREVIEW_LENGTH } from "./config.js";
import type { PendingEvent, DiffStats } from "./types.js";

export function truncateText(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

export function formatTimeOnly(ts: number | string): string {
  const d = new Date(typeof ts === "string" ? parseInt(ts, 10) : ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || isNaN(ms) || ms <= 0) return "";
  if (ms < 1000) return `(${ms}ms)`;
  if (ms < 60000) return `(${(ms / 1000).toFixed(1)}s)`;
  return `(${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s)`;
}

export function parseDiffStats(diff: string | undefined): DiffStats | undefined {
  if (!diff) return undefined;
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;
  let addedChars = 0;
  let removedChars = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      addedChars += line.length - 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      removedChars += line.length - 1;
    }
  }
  return (added > 0 || removed > 0) ? { added, removed, addedChars, removedChars } : undefined;
}

export function extractSenderName(content: unknown[]): string {
  for (const item of content) {
    if (item && typeof item === "object" && "type" in item && (item as { type?: string }).type === "text") {
      const text = (item as { text?: string }).text || "";
      const senderMatch = text.match(/"(?:label|name|username)":\s*"([^"]+)"/);
      if (senderMatch) return senderMatch[1];
    }
  }
  return "User";
}

// Helper to safely extract arg values from data or args
function getArg(data: Record<string, unknown>, key: string): string {
  const args = data.args as Record<string, unknown> | undefined;
  return String(data[key] || args?.[key] || "");
}

export function formatEvent(event: PendingEvent): string | null {
  const time = formatTimestamp(event.timestamp);
  const { type, data } = event;
  const errorPrefix = data.isError ? "❌ " : "";

  if (type === "tool_call" || type === "call" || type === "toolCall") {
    const name = String(data.name || "");
    const icon = TOOL_ICONS[name] || "🔧";
    const durationMs = data.durationMs as number | null;
    const durationStr = formatDuration(durationMs);
    const diffStats = data.diffStats as DiffStats | undefined;

    if (name === "exec" || name === "bash") {
      const cmd = String(data.command || (data.args as Record<string, unknown> | undefined)?.command || "");
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(cmd, TOOL_PREVIEW_LENGTH)}`;
    }
    if (name === "edit" || name === "write") {
      const args = data.args as Record<string, unknown> | undefined;
      const path = String(data.file_path || data.path || args?.file_path || args?.path || args?.filePath || "");
      const summary = path || "(unknown)";
      let diffStr = "";
      if (diffStats) {
        diffStr = ` (+${diffStats.added}/-${diffStats.removed} lines, +${diffStats.addedChars}/-${diffStats.removedChars} chars)`;
      }
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}${diffStr}: \`${summary}\``;
    }
    if (name === "read") {
      const args = data.args as Record<string, unknown> | undefined;
      const path = String(data.file_path || data.path || args?.file_path || args?.path || args?.filePath || "");
      return `${time} ${errorPrefix}${icon} read${durationStr}: \`${path || "(unknown)"}\``;
    }
    if (["grep_search", "glob_search", "grep", "glob"].includes(name)) {
      const pattern = String(data.pattern || (data.args as Record<string, unknown> | undefined)?.pattern || "");
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(pattern, TOOL_PREVIEW_LENGTH)}`;
    }
    if (["webfetch", "web_fetch", "web_search", "http", "http_request"].includes(name)) {
      const args = data.args as Record<string, unknown> | undefined;
      const url = String(data.url || args?.url || "");
      const query = String(data.query || args?.query || "");
      // For web_search, show query; for others, show url
      const display = name === "web_search" ? query : url;
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${truncateText(display, TOOL_PREVIEW_LENGTH)}`;
    }

    // Process tool - shows action + command + sessionId + status
    if (name === "process") {
      const action = getArg(data, "action");
      const sessionId = getArg(data, "sessionId");
      const command = getArg(data, "name");
      const status = getArg(data, "status");
      const exitCode = getArg(data, "exitCode");

      let details = action;

      // Show command for spawn
      if (command && (action === "spawn" || action === "list")) {
        details += ` [${truncateText(command, 30)}]`;
      }

      // Show status for poll
      if (status && action === "poll") {
        details += ` (${status})`;
        if (exitCode !== "" && exitCode !== "0") {
          details += ` exit:${exitCode}`;
        }
      }
      // Show sessionId for other actions
      else if (sessionId && !status) {
        details += ` (${truncateText(sessionId, 20)})`;
      }

      return `${time} ${errorPrefix}${icon} process${durationStr}: ${details}`;
    }

    // Gateway tool - shows action
    if (name === "gateway") {
      const action = getArg(data, "action");
      return `${time} ${errorPrefix}${icon} gateway${durationStr}: ${action || "call"}`;
    }

    // Sessions tools - shows action + label/target
    if (name === "sessions_spawn") {
      const label = getArg(data, "label");
      const model = getArg(data, "model");
      return `${time} ${errorPrefix}${icon} spawn${durationStr}: ${truncateText(label, TOOL_PREVIEW_LENGTH)}${model ? ` [${model}]` : ""}`;
    }
    if (name === "sessions_list" || name === "sessions_history") {
      const action = getArg(data, "action") || name.replace("sessions_", "");
      return `${time} ${errorPrefix}${icon} ${name}${durationStr}: ${action}`;
    }
    if (name === "sessions_send") {
      const target = getArg(data, "target");
      return `${time} ${errorPrefix}${icon} send${durationStr}: ${truncateText(target, TOOL_PREVIEW_LENGTH)}`;
    }

    // Message tool - shows channel + target + message preview
    if (name === "message") {
      const channel = getArg(data, "channel");
      const target = getArg(data, "target");
      const message = getArg(data, "message");

      // Format target for display (truncate long IDs)
      let targetDisplay = "";
      if (target) {
        // Show "channel:14647668..." or "user:12345678..."
        targetDisplay = target.length > 20
          ? ` → ${target.slice(0, 20)}...`
          : ` → ${target}`;
      }

      return `${time} ${errorPrefix}${icon} message${durationStr}: ${channel}${targetDisplay}${message ? ` - ${truncateText(message, TOOL_PREVIEW_LENGTH)}` : ""}`;
    }

    // Subagents tool - shows action + target
    if (name === "subagents") {
      const action = getArg(data, "action");
      const target = getArg(data, "target");
      const recent = getArg(data, "recentMinutes");
      if (action === "list" && recent) {
        return `${time} ${errorPrefix}${icon} subagents${durationStr}: list (last ${recent}m)`;
      }
      return `${time} ${errorPrefix}${icon} subagents${durationStr}: ${action}${target ? ` ${truncateText(target, TOOL_PREVIEW_LENGTH)}` : ""}`;
    }

    // Cron tool - shows action + schedule + job name/jobId
    if (name === "cron") {
      const action = getArg(data, "action");
      const jobId = getArg(data, "jobId");
      const args = data.args as Record<string, unknown> | undefined;
      const job = args?.job as Record<string, unknown> | undefined;
      const jobSchedule = job?.schedule as Record<string, unknown> | undefined;
      const jobName = job?.name as string | undefined;
      const schedule = getArg(data, "schedule") || getArg(data, "cron") || String(jobSchedule?.expr || "");

      let details = action;
      if (schedule) details += ` [${truncateText(schedule, 30)}]`;
      if (jobName && action === "add") details += ` "${truncateText(jobName, 20)}"`;
      if (jobId && action !== "add") details += ` (${truncateText(jobId, 20)})`;

      return `${time} ${errorPrefix}${icon} cron${durationStr}: ${details}`;
    }

    // GitHub CLI - shows command
    if (name === "gh") {
      const command = getArg(data, "command") || getArg(data, "args");
      return `${time} ${errorPrefix}${icon} gh${durationStr}: ${truncateText(command, TOOL_PREVIEW_LENGTH)}`;
    }

    // Memory search - shows query
    if (name === "memory_search") {
      const query = getArg(data, "query");
      return `${time} ${errorPrefix}${icon} memory${durationStr}: ${truncateText(query, TOOL_PREVIEW_LENGTH)}`;
    }

    // Browser - shows url
    if (name === "browser") {
      const url = getArg(data, "url");
      return `${time} ${errorPrefix}${icon} browser${durationStr}: ${truncateText(url, TOOL_PREVIEW_LENGTH)}`;
    }

    return `${time} ${errorPrefix}${icon} ${name}${durationStr}`;
  }

  if (type === "user_message") {
    const sender = String(data.sender || "User");
    const preview = String(data.preview || data.text || "");
    // Skip metadata-only messages
    if (!preview || preview.trim() === "...." || preview.trim() === "") {
      return null;
    }
    return `${time} 💬 ${sender}:\n\`\`\`\n${truncateText(preview, 300)}\n\`\`\``;
  }

  if (type === "assistant_complete" || type === "complete") {
    const tokens = data.tokens as number | undefined;
    const messagePreview = String(data.messagePreview || data.text || "");
    let msg = `${time} ✅ Response completed`;
    if (tokens) msg += ` (${tokens.toLocaleString()} tokens)`;
    if (messagePreview) msg += `: "${truncateText(messagePreview.replace(/\n/g, " "), TOOL_PREVIEW_LENGTH)}"`;
    return msg;
  }

  if (type === "thinking") {
    const preview = String(data.preview || data.text || "");
    return `${time} 💭 Thinking: "${truncateText(preview.replace(/\n/g, " "), TOOL_PREVIEW_LENGTH)}"`;
  }

  if (type === "thinking_level") {
    const level = String(data.level || "unknown");
    return `${time} 🧠 Thinking level: ${level}`;
  }

  if (type === "error") {
    const msg = String(data.error || data.message || "Unknown error");
    return `${time} ❌ Error: ${truncateText(msg, TOOL_PREVIEW_LENGTH)}`;
  }

  if (type === "model_change") {
    const oldModel = String(data.oldModel || "");
    const newModel = String(data.newModel || data.to || data.model || "");
    if (oldModel && newModel) {
      return `${time} 🔄 Model changed: ${oldModel} → ${newModel}`;
    }
    return `${time} 🔄 Model: ${newModel}`;
  }

  if (type === "context_compaction" || type === "compaction") {
    return `${time} 🗜️ Context compaction`;
  }

  if (type === "image") {
    const mime = String(data.mimeType || data.mime_type || "image");
    return `${time} 🖼️ Image: ${mime}`;
  }

  return `${time} 📌 ${type}`;
}
