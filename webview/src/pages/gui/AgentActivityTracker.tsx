/**
 * Agent Activity Tracker for KODRA.
 *
 * Renders a collapsible, lightweight activity timeline showing
 * the agent's tool usage during the current execution session.
 *
 * Events flow: Extension → postMessage → global listener → this component state.
 *
 * Design: Sits between the chat messages and the input box.
 * Each tool call is a row with status icon, human-readable label, and optional timing.
 * The whole tracker is collapsible via a header toggle.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolActivityEntry {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: 'requested' | 'executing' | 'completed' | 'failed';
  durationMs?: number;
  startedAt: number;
  completedAt?: number;
}

export interface PendingApproval {
  toolName: string;
  description: string;
  command?: string;
  filepath?: string;
  diff?: string;
}

interface AgentActivityTrackerProps {
  /** Tool activity entries for the current execution */
  entries: ToolActivityEntry[];
  /** Whether the agent is currently running */
  isRunning: boolean;
  /** Pending approval request, if any */
  pendingApproval: PendingApproval | null;
  /** Callback when user approves/rejects a tool */
  onApprovalDecision: (approved: boolean) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getHumanReadableLabel(entry: ToolActivityEntry): string {
  const { toolName, args } = entry;

  const file = args?.file || args?.filePath || args?.path;
  const query = args?.query || args?.pattern;
  const command = args?.command;
  const dir = args?.path || args?.dir || args?.directory;

  switch (toolName) {
    case 'read_file':
      return file ? `Read ${basename(String(file))}` : 'Reading file';
    case 'list_directory':
      return dir ? `List ${basename(String(dir))}/` : 'Listing directory';
    case 'search_code':
      return query ? `Search "${truncate(String(query), 30)}"` : 'Searching codebase';
    case 'create_file':
      return file ? `Create ${basename(String(file))}` : 'Creating file';
    case 'edit_file':
      return file ? `Edit ${basename(String(file))}` : 'Editing file';
    case 'terminal':
    case 'run_command':
      return command ? `Run: ${truncate(String(command), 40)}` : 'Running command';
    default:
      return toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

function basename(filepath: string): string {
  const parts = filepath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filepath;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getCategoryLabel(toolName: string): string {
  if (['read_file', 'list_directory', 'create_file', 'edit_file'].includes(toolName)) {
    return 'File Operations';
  }
  if (['search_code', 'search_files'].includes(toolName)) {
    return 'Searching';
  }
  if (['terminal', 'run_command'].includes(toolName)) {
    return 'Terminal';
  }
  return 'Tools';
}

// ─── Status Icons ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ToolActivityEntry['status'] }) {
  switch (status) {
    case 'requested':
    case 'executing':
      return (
        <span className="inline-flex items-center justify-center w-4 h-4 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        </span>
      );
    case 'completed':
      return (
        <svg className="w-4 h-4 flex-shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'failed':
      return (
        <svg className="w-4 h-4 flex-shrink-0 text-red-400" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
  }
}

// ─── Approval Section ──────────────────────────────────────────────────────

function ApprovalSection({
  approval,
  onDecision,
}: {
  approval: PendingApproval;
  onDecision: (approved: boolean) => void;
}) {
  return (
    <div className="mx-0 mt-1.5 p-3 rounded-lg border border-amber-500/30 bg-amber-950/10 text-sm animate-fadeIn">
      <div className="flex items-center gap-2 mb-2 font-medium text-amber-400 text-xs">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span>Permission Required</span>
      </div>
      <p className="text-gray-300 text-xs mb-2">{approval.description}</p>

      {approval.command && (
        <div className="my-2 p-2 bg-[#090A0F] rounded border border-gray-800/80 font-mono text-xs text-emerald-400 overflow-x-auto select-all">
          <span className="text-gray-500 select-none mr-1.5">$</span>
          {approval.command}
        </div>
      )}

      {approval.filepath && (
        <div className="my-1 text-xs text-gray-400">
          Target: <code className="text-gray-200 bg-gray-800/50 px-1 py-0.5 rounded">{approval.filepath}</code>
        </div>
      )}

      <div className="flex gap-2 mt-3 justify-end">
        <button
          type="button"
          onClick={() => onDecision(false)}
          className="px-3 py-1 rounded bg-[#202533] hover:bg-[#2A3142] text-xs text-gray-300 transition-colors"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => onDecision(true)}
          className="px-3.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-sm transition-colors"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function AgentActivityTracker({
  entries,
  isRunning,
  pendingApproval,
  onApprovalDecision,
}: AgentActivityTrackerProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Compute summary counts
  const completedCount = entries.filter(e => e.status === 'completed').length;
  const failedCount = entries.filter(e => e.status === 'failed').length;
  const activeCount = entries.filter(e => e.status === 'executing' || e.status === 'requested').length;

  // Group entries by category for visual grouping (must be before early return — Rules of Hooks)
  const groupedEntries = useMemo(() => {
    const groups: Map<string, ToolActivityEntry[]> = new Map();
    for (const entry of entries) {
      const cat = getCategoryLabel(entry.toolName);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(entry);
    }
    return groups;
  }, [entries]);

  // Don't render when there's nothing to show
  if (entries.length === 0 && !isRunning && !pendingApproval) {
    return null;
  }

  const headerLabel = isRunning
    ? activeCount > 0
      ? `Working${activeCount > 0 ? ` · ${activeCount} active` : ''}`
      : 'Thinking...'
    : entries.length > 0
      ? `Completed · ${completedCount} tool${completedCount !== 1 ? 's' : ''}${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
      : '';

  return (
    <div className="mx-3 my-1.5 select-none" id="agent-activity-tracker">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setIsCollapsed(prev => !prev)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs
                   bg-[#12141C]/60 hover:bg-[#181B26]/80 border border-gray-800/40
                   transition-colors duration-150 cursor-pointer group"
        aria-expanded={!isCollapsed}
        aria-controls="agent-activity-entries"
      >
        {/* Collapse chevron */}
        <svg
          className={`w-3 h-3 text-gray-500 group-hover:text-gray-300 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Running indicator dot */}
        {isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
        )}
        {!isRunning && entries.length > 0 && failedCount === 0 && (
          <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {!isRunning && failedCount > 0 && (
          <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v6M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}

        <span className="text-gray-400 group-hover:text-gray-200 transition-colors truncate">
          {headerLabel}
        </span>

        {/* Tool count badge */}
        {entries.length > 0 && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800/60 text-gray-500">
            {entries.length}
          </span>
        )}
      </button>

      {/* ── Collapsible body ── */}
      {!isCollapsed && (
        <div
          id="agent-activity-entries"
          className="mt-1 ml-1 pl-3 border-l border-gray-800/50 space-y-0.5 animate-fadeIn"
        >
          {/* Pending approval (always at top when present) */}
          {pendingApproval && (
            <ApprovalSection
              approval={pendingApproval}
              onDecision={onApprovalDecision}
            />
          )}

          {/* Grouped tool entries */}
          {Array.from(groupedEntries.entries()).map(([category, catEntries]) => (
            <div key={category} className="mb-1">
              {groupedEntries.size > 1 && (
                <div className="text-[10px] text-gray-600 uppercase tracking-wider font-medium mt-1.5 mb-0.5 px-1">
                  {category}
                </div>
              )}
              {catEntries.map((entry) => (
                <div
                  key={entry.toolCallId}
                  className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-800/20 transition-colors"
                >
                  <StatusIcon status={entry.status} />
                  <span className={`text-xs truncate ${
                    entry.status === 'failed' ? 'text-red-300' :
                    entry.status === 'completed' ? 'text-gray-300' :
                    'text-gray-400'
                  }`}>
                    {getHumanReadableLabel(entry)}
                  </span>
                  {entry.durationMs !== undefined && entry.status !== 'executing' && entry.status !== 'requested' && (
                    <span className="ml-auto text-[10px] text-gray-600 tabular-nums flex-shrink-0">
                      {formatDuration(entry.durationMs)}
                    </span>
                  )}
                  {(entry.status === 'executing' || entry.status === 'requested') && (
                    <span className="ml-auto">
                      <span className="inline-block w-3 text-[10px] text-gray-500 animate-pulse">···</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
