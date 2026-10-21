/**
 * Storage types and data structures for KODRA persistent storage.
 */

export const STORAGE_SCHEMA_VERSION = 1;

export type ConversationStatus = 'active' | 'completed' | 'interrupted' | 'error' | 'cancelled';

export interface StoredArtifactRef {
  id: string;
  type: string;
  title: string;
  filename?: string;
  createdAt: string;
}

export interface StoredConversation {
  sessionId: string;
  title: string;
  dateCreated: string;
  lastModified: string;
  workspaceDirectory: string;
  workspaceId: string;
  workspaceName: string;
  status: ConversationStatus;
  mode?: string;
  chatModelTitle?: string | null;
  history: any[]; // ChatHistoryItem[]
  artifacts?: StoredArtifactRef[];
  executionIds?: string[];
  schemaVersion: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationIndexEntry {
  sessionId: string;
  title: string;
  dateCreated: string;
  lastModified: string;
  workspaceDirectory: string;
  workspaceId: string;
  workspaceName: string;
  messageCount: number;
  status: ConversationStatus;
  hasInterruptedRun?: boolean;
}

export interface ExecutionJournalEvent {
  eventId: string;
  executionId: string;
  conversationId: string;
  workspaceId: string;
  timestamp: number;
  type: string;
  data?: Record<string, unknown>;
}

export interface StoredArtifact {
  id: string;
  conversationId: string;
  executionId?: string;
  title: string;
  type: 'patch' | 'file' | 'plan' | 'summary' | 'walkthrough' | 'report' | 'custom';
  filename?: string;
  filepath?: string;
  content: string;
  diff?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRecord {
  id: string;
  path: string;
  name: string;
  firstSeen: string;
  lastSeen: string;
}

export interface StorageMetadata {
  schemaVersion: number;
  initializedAt: string;
  lastUpdatedAt: string;
  kodraVersion: string;
}
