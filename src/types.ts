/**
 * Type definitions for session-audit
 */

export interface Config {
  channel: string;
  targetId: string;
  rateLimitMs: number;
  batchWindowMs: number;
  maxBatchSize: number;
  maxMessageLength: number;
  maxFileSize: number;
  maxSeenIds: number;
  agentEmojis: Record<string, string>;
  headerIntervalMs: number;
}

export interface PendingEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
  id: string;
  sessionKey: string;
  threadNumber?: string;
}

export interface SessionMetadata {
  cwd: string;
  projectName: string;
  model: string;
  chatType: string;
  key: string;
  agentName?: string;
  contextTokens?: number;
  usedTokens?: number;
  provider?: string;
  surface?: string;
  updatedAt?: string;
  groupId?: string;
  thinkingLevel?: string;
}

export interface State {
  offsets: Record<string, number>;
  seenIds: string[];
}

export interface ToolCallTimestamp {
  timestamp: number;
  sessionKey: string;
}

export interface ProjectInfo {
  name: string;
  emoji: string;
  model: string;
  chatType: string;
  shortId: string;
  keyDisplay: string;
  isSubagent: boolean;
  agentName: string;
  cwd: string;
  contextTokens: string;
  provider: string;
  surface: string;
  updatedAt: string;
  groupId: string;
  thinkingLevel: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  addedChars: number;
  removedChars: number;
}
