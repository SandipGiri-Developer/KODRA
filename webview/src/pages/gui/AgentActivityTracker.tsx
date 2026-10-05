/**
 * AgentActivityTracker - Kodra
 *
 * Collapsible activity section that sits between the chat messages and the
 * input box. Shows what the agent is doing while it works: which tools ran,
 * whether they succeeded or failed, and any pending approvals.
 *
 * Design principles (per Kodra UX spec):
 * - Minimal, professional, calm, unobtrusive
 * - No large cards, no gradients, no decorative chrome
 * - Clear typography and consistent spacing
 * - Subtle state indicators using text symbols + muted color
 * - Respects prefers-reduced-motion
 * - Full keyboard navigation and ARIA labels
 * - Auto-collapses when agent completes
 *
 * Event flow: Extension -> postMessage -> Chat.tsx -> props -> this component
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolStatus = 'requested' | 'executing' | 'completed' | 'failed';

export interface ToolActivityEntry {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
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

export interface AgentActivityTrackerProps {
  entries: ToolActivityEntry[];
  isRunning: boolean;
  pendingApproval: PendingApproval | null;
  onApprovalDecision: (approved: boolean) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? p;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Build a human-readable label for a tool call.
 * Falls back to the tool name with underscores replaced by spaces.
 */
function getHumanLabel(entry: ToolActivityEntry): string {
  const { toolName, args } = entry;
  const file = args ? String(args.file ?? args.filePath ?? args.path ?? '') : '';
  const query = args ? String(args.query ?? args.pattern ?? '') : '';
  const command = args ? String(args.command ?? '') : '';
  const dir = args ? String(args.path ?? args.dir ?? args.directory ?? '') : '';

  switch (toolName) {
    case 'read_file':
      return file ? `Read \`${basename(file)}\`` : 'Reading file';
    case 'list_directory':
      return dir ? `List \`${basename(dir) || dir}/\`` : 'Listing directory';
    case 'search_code':
      return query ? `Search \`${clip(query, 32)}\`` : 'Searching codebase';
    case 'search_files':
      return query ? `Find \`${clip(query, 32)}\`` : 'Finding files';
    case 'create_file':
      return file ? `Create \`${basename(file)}\`` : 'Creating file';
    case 'edit_file':
    case 'write_file':
      return file ? `Edit \`${basename(file)}\`` : 'Editing file';
    case 'terminal':
    case 'run_command':
      return command ? `Run \`${clip(command, 42)}\`` : 'Running command';
    case 'get_diagnostics':
      return 'Get diagnostics';
    case 'find_definition':
    case 'go_to_definition':
      return query ? `Find definition of \`${clip(query, 28)}\`` : 'Finding definition';
    default:
      return toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * Replace `backtick` spans in the label with inline-code styled HTML.
 * Only called on our own constructed strings — safe, no external input.
 */
function renderLabel(label: string): string {
  return label.replace(
    /`([^`]+)`/g,
    '<code style="font-size:10px;opacity:0.85;background:rgba(128,128,128,0.12);padding:0 3px;border-radius:3px;font-family:var(--vscode-editor-font-family,monospace)">$1</code>',
  );
}

// ─── Status indicator ─────────────────────────────────────────────────────────
// Uses text glyphs AND color so status is never communicated by color alone.

function StatusMark({ status, label }: { status: ToolStatus; label: string }) {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (status === 'executing' || status === 'requested') {
    return (
      <span
        aria-label={`Running: ${label}`}
        role="status"
        className={`inline-block text-[var(--vscode-textLink-foreground,#6ca0f5)] text-[11px] w-[14px] flex-shrink-0 select-none ${
          prefersReduced ? 'opacity-60' : 'animate-spin'
        }`}
        style={prefersReduced ? {} : { animationDuration: '1.4s' }}
      >
        {'\u27f3'}
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span
        aria-label={`Completed: ${label}`}
        role="img"
        className="inline-block text-[var(--vscode-terminal-ansiGreen,#4dbb71)] text-[11px] w-[14px] flex-shrink-0 select-none"
      >
        {'\u2713'}
      </span>
    );
  }

  return (
    <span
      aria-label={`Failed: ${label}`}
      role="img"
      className="inline-block text-[var(--vscode-errorForeground,#f14c4c)] text-[11px] w-[14px] flex-shrink-0 select-none"
    >
      {'\u2715'}
    </span>
  );
}

// ─── Single tool row ──────────────────────────────────────────────────────────

function ToolRow({ entry }: { entry: ToolActivityEntry }) {
  const label = useMemo(() => getHumanLabel(entry), [entry]);
  const isActive = entry.status === 'executing' || entry.status === 'requested';
  const hasDuration = entry.durationMs !== undefined && !isActive;

  return (
    <div
      className={`flex items-center gap-2 py-[2px] px-1 min-w-0 transition-opacity duration-100 ${
        isActive ? 'opacity-100' : 'opacity-75 hover:opacity-100'
      }`}
    >
      <StatusMark status={entry.status} label={label} />
      <span
        className={`text-[11px] leading-tight truncate flex-1 min-w-0 ${
          entry.status === 'failed'
            ? 'text-[var(--vscode-errorForeground,#f14c4c)]'
            : isActive
            ? 'text-[var(--vscode-foreground,#cccccc)]'
            : 'text-[var(--vscode-descriptionForeground,#9d9d9d)]'
        }`}
        dangerouslySetInnerHTML={{ __html: renderLabel(label) }}
      />
      {hasDuration && (
        <span className="ml-auto text-[10px] text-[var(--vscode-descriptionForeground,#9d9d9d)] tabular-nums flex-shrink-0 pl-2">
          {fmtDuration(entry.durationMs!)}
        </span>
      )}
    </div>
  );
}

// ─── Approval section ─────────────────────────────────────────────────────────

function ApprovalSection({
  approval,
  onDecision,
}: {
  approval: PendingApproval;
  onDecision: (approved: boolean) => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Action requires approval"
      className="mt-1.5 mb-1 px-3 py-2.5 rounded border border-[var(--vscode-inputValidation-warningBorder,#b89500)] bg-[var(--vscode-inputValidation-warningBackground,rgba(255,200,0,0.05))]"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          aria-hidden="true"
          className="text-[var(--vscode-editorWarning-foreground,#cca700)] text-[11px]"
        >
          {'\u26a0'}
        </span>
        <span className="text-[11px] font-medium text-[var(--vscode-editorWarning-foreground,#cca700)]">
          {approval.description}
        </span>
      </div>

      {approval.command && (
        <pre className="text-[10px] font-mono text-[var(--vscode-terminal-foreground,#cccccc)] bg-[var(--vscode-terminal-background,rgba(0,0,0,0.18))] rounded px-2 py-1.5 mb-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          <span className="opacity-40 select-none">{'$ '}</span>
          {approval.command}
        </pre>
      )}

      {approval.filepath && (
        <div className="text-[10px] text-[var(--vscode-descriptionForeground,#9d9d9d)] mb-2">
          {'File: '}
          <code className="text-[var(--vscode-foreground,#cccccc)] opacity-80">
            {approval.filepath}
          </code>
        </div>
      )}

      <div className="flex gap-2 mt-2 justify-end">
        <button
          type="button"
          onClick={() => onDecision(false)}
          className="px-3 py-1 text-[11px] rounded bg-[var(--vscode-button-secondaryBackground,#3a3d41)] hover:bg-[var(--vscode-button-secondaryHoverBackground,#45494e)] text-[var(--vscode-button-secondaryForeground,#cccccc)] transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"
          aria-label="Reject action"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => onDecision(true)}
          className="px-3 py-1 text-[11px] rounded bg-[var(--vscode-button-background,#0e639c)] hover:bg-[var(--vscode-button-hoverBackground,#1177bb)] text-[var(--vscode-button-foreground,#ffffff)] font-medium transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]"
          aria-label="Approve action"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AgentActivityTracker({
  entries,
  isRunning,
  pendingApproval,
  onApprovalDecision,
}: AgentActivityTrackerProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const prevIsRunningRef = useRef(isRunning);

  // Auto-collapse when the agent finishes
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && entries.length > 0) {
      setIsCollapsed(true);
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning, entries.length]);

  // Auto-expand when a new run starts
  useEffect(() => {
    if (isRunning) {
      setIsCollapsed(false);
    }
  }, [isRunning]);

  const completedCount = entries.filter((e) => e.status === 'completed').length;
  const failedCount = entries.filter((e) => e.status === 'failed').length;
  const activeEntry = entries.find(
    (e) => e.status === 'executing' || e.status === 'requested',
  );

  // Must be declared before any early return — Rules of Hooks
  const toggleCollapsed = useCallback(() => setIsCollapsed((prev) => !prev), []);

  // Nothing to show
  if (entries.length === 0 && !isRunning && !pendingApproval) {
    return null;
  }

  // ── Header text ──
  let headerStatus: string;
  if (pendingApproval && !isRunning) {
    headerStatus = 'Waiting for approval';
  } else if (isRunning) {
    headerStatus = activeEntry
      ? getHumanLabel(activeEntry).replace(/`([^`]+)`/g, '$1')
      : 'Working\u2026';
  } else if (failedCount > 0) {
    headerStatus = `Done \u00b7 ${completedCount} completed \u00b7 ${failedCount} failed`;
  } else {
    headerStatus = `Done \u00b7 ${entries.length} action${entries.length !== 1 ? 's' : ''}`;
  }

  // ── Header leading mark ──
  let headerMark: React.ReactNode;
  if (pendingApproval && !isRunning) {
    headerMark = (
      <span
        aria-hidden="true"
        className="text-[var(--vscode-editorWarning-foreground,#cca700)] text-[11px] flex-shrink-0"
      >
        {'\u26a0'}
      </span>
    );
  } else if (isRunning) {
    headerMark = (
      <span
        aria-label="Working"
        className="w-[6px] h-[6px] rounded-full flex-shrink-0 bg-[var(--vscode-textLink-foreground,#6ca0f5)] animate-pulse"
      />
    );
  } else if (failedCount > 0) {
    headerMark = (
      <span
        aria-hidden="true"
        className="text-[var(--vscode-editorWarning-foreground,#cca700)] text-[11px] flex-shrink-0"
      >
        {'\u26a0'}
      </span>
    );
  } else {
    headerMark = (
      <span
        aria-hidden="true"
        className="text-[var(--vscode-terminal-ansiGreen,#4dbb71)] text-[11px] flex-shrink-0"
      >
        {'\u2713'}
      </span>
    );
  }

  return (
    <div
      className="select-none px-3 py-1"
      id="agent-activity-tracker"
      role="region"
      aria-label="Agent activity"
    >
      {/* ── Header toggle button ── */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!isCollapsed}
        aria-controls="agent-activity-entries"
        className={[
          'w-full flex items-center gap-1.5 py-1 px-1.5 rounded text-left',
          'text-[var(--vscode-descriptionForeground,#9d9d9d)]',
          'hover:text-[var(--vscode-foreground,#cccccc)]',
          'hover:bg-[var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))]',
          'transition-colors duration-100',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]',
          'cursor-pointer',
        ].join(' ')}
      >
        {/* Chevron */}
        <svg
          className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${
            isCollapsed ? '-rotate-90' : ''
          }`}
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {headerMark}

        <span className="text-[11px] leading-tight truncate">{headerStatus}</span>

        {entries.length > 0 && (
          <span
            aria-label={`${entries.length} actions`}
            className="ml-auto text-[10px] tabular-nums text-[var(--vscode-descriptionForeground,#9d9d9d)] opacity-60 flex-shrink-0"
          >
            {entries.length}
          </span>
        )}
      </button>

      {/* ── Collapsible body ── */}
      {!isCollapsed && (
        <div
          id="agent-activity-entries"
          role="list"
          aria-label="Tool activity list"
          aria-live="polite"
          aria-atomic="false"
          className="mt-0.5 pl-[18px] border-l border-[var(--vscode-widget-border,rgba(128,128,128,0.18))]"
        >
          {/* Approval block — always first when present */}
          {pendingApproval && (
            <div role="listitem">
              <ApprovalSection approval={pendingApproval} onDecision={onApprovalDecision} />
            </div>
          )}

          {/* Tool rows */}
          {entries.map((entry) => (
            <div key={entry.toolCallId} role="listitem">
              <ToolRow entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
