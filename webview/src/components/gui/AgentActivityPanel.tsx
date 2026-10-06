/**
 * AgentActivityPanel — "Worked for Xs" collapsible activity section.
 *
 * Driven entirely by real agentActivity IPC messages from the extension host.
 * Groups tools and thoughts by the resource they explore.
 */

import { useEffect, useState } from "react";
import { WrenchScrewdriverIcon, XMarkIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/outline";

// ─── Activity event types ────────────────────────────────────────────────────

type ActivityEventKind =
  | { kind: "started"; timestamp: number }
  | { kind: "thinking"; timestamp: number }
  | { kind: "tool_started"; toolName: string; toolCallId: string; args: Record<string, unknown>; timestamp: number }
  | { kind: "tool_completed"; toolName: string; toolCallId: string; durationMs: number; success: boolean; metadata?: Record<string, unknown>; timestamp: number }
  | { kind: "tool_failed"; toolName: string; toolCallId: string; error: string; durationMs: number; timestamp: number }
  | { kind: "completed"; durationMs: number; timestamp: number }
  | { kind: "failed"; error: string; timestamp: number }
  | { kind: "cancelled"; timestamp: number };

export interface AgentActivityMessage {
  executionId: string;
  event: ActivityEventKind;
}

interface ToolActivity {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

type Entry =
  | { type: "thought"; id: string; startTime: number; endTime?: number }
  | { type: "tool"; tool: ToolActivity };

interface ActivityGroup {
  id: string;
  target: string;
  toolName: string;
  items: Entry[];
  status: "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
}

// ─── Helper functions ────────────────────────────────────────────────────────

function extractTarget(args?: Record<string, unknown>): { target: string; fullPath: string } {
  const fp = (args?.filepath ?? args?.file ?? args?.path ?? args?.targetFile ?? args?.directory ?? args?.DirectoryPath ?? args?.AbsolutePath ?? args?.TargetFile ?? args?.SearchPath ?? "") as string;
  let target = fp;
  if (fp) {
    const parts = fp.split(/[/\\]/).filter(Boolean);
    target = parts.length > 2 ? parts.slice(-2).join("/") : (parts.pop() || fp);
  }
  return { target: target || "", fullPath: fp };
}

function getGroupLabel(toolName: string, args?: Record<string, unknown>): string {
  const { target } = extractTarget(args);
  if (toolName === "list_directory" || toolName === "list_dir") {
    let t = target || "directory";
    if (t !== "directory" && !t.endsWith("/")) t += "/";
    return `Explored ${t}`;
  }
  if (toolName === "read_file" || toolName === "view_file" || toolName === "grep_search") {
    return `Explored ${target || "file"}`;
  }
  if (toolName === "edit_file" || toolName === "create_file" || toolName === "write_to_file" || toolName === "replace_file_content" || toolName === "multi_replace_file_content") {
    return `Edited ${target || "file"}`;
  }
  if (toolName === "run_command" || toolName === "terminal") {
    return `Ran command`;
  }
  if (toolName === "search_web") {
    return `Searched web`;
  }
  return `Used ${toolName}`;
}

function getInnerLabel(tool: ToolActivity): string {
  const { target } = extractTarget(tool.args);
  if (tool.toolName === "read_file" || tool.toolName === "view_file" || tool.toolName === "grep_search") {
    const start = (tool.metadata?.startLine ?? tool.args?.startLine ?? tool.args?.StartLine) as number | undefined;
    const end = (tool.metadata?.endLine ?? tool.args?.endLine ?? tool.args?.EndLine) as number | undefined;
    const range = start && end ? `#L${start}-${end}` : (start ? `#L${start}-` : "");
    return `Analyzed ${target || "file"}${range}`;
  }
  if (tool.toolName === "list_directory" || tool.toolName === "list_dir") {
    let t = target || "directory";
    if (t !== "directory" && !t.endsWith("/")) t += "/";
    return `Explored ${t}`;
  }
  if (tool.toolName === "edit_file" || tool.toolName === "create_file" || tool.toolName === "write_to_file" || tool.toolName === "replace_file_content" || tool.toolName === "multi_replace_file_content") {
    return `Edited ${target || "file"}`;
  }
  if (tool.toolName === "run_command" || tool.toolName === "terminal") {
    return `Ran command`;
  }
  return `Ran ${tool.toolName}`;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function ToolIcon() {
  return <WrenchScrewdriverIcon style={{ width: 12, height: 12, flexShrink: 0 }} />;
}

function ErrorIcon() {
  return <XMarkIcon style={{ width: 12, height: 12, flexShrink: 0 }} />;
}

function RunningIcon() {
  return <EllipsisHorizontalIcon style={{ width: 12, height: 12, flexShrink: 0 }} />;
}

// ─── Chevron icon ────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 150ms ease",
        flexShrink: 0,
      }}
    >
      <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── InnerToolRow ────────────────────────────────────────────────────────────

function InnerToolRow({ tool, now, hideLabel }: { tool: ToolActivity; now: number; hideLabel?: boolean }) {
  const endTime = tool.status === "running" ? now : tool.endTime;
  const durationSec = endTime ? ((endTime - tool.startTime) / 1000).toFixed(1) : null;
  const label = getInnerLabel(tool);

  return (
    <div style={{ marginBottom: 2 }}>
      {!hideLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "1px 0",
            width: "100%",
            textAlign: "left",
          }}
        >
          <span
            onClick={() => {
              const { fullPath } = extractTarget(tool.args);
              if (fullPath && tool.toolName !== 'list_directory' && tool.toolName !== 'list_dir') {
                (window as any).vscode?.postMessage({ type: "openFile", filepath: fullPath });
              }
            }}
            style={{
              fontSize: 11,
              color: "var(--vscode-descriptionForeground, #9d9d9d)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: (extractTarget(tool.args).fullPath && tool.toolName !== 'list_directory' && tool.toolName !== 'list_dir') ? "pointer" : "default",
            }}
            className={(extractTarget(tool.args).fullPath && tool.toolName !== 'list_directory' && tool.toolName !== 'list_dir') ? "hover:underline hover:text-[var(--vscode-foreground,#cccccc)] transition-colors" : ""}
          >
            {label}
          </span>
          <div style={{ flex: 1 }} />
          {durationSec && (
            <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.6, flexShrink: 0 }}>
              {durationSec}s
            </span>
          )}
        </div>
      )}
      
      {Array.isArray(tool.metadata?.entries) && (
        <div style={{ paddingLeft: hideLabel ? 0 : 8, paddingTop: 2 }}>
          {(tool.metadata!.entries as string[]).slice(0, 10).map((entry: string, idx: number) => (
            <div key={idx} style={{ fontSize: 10, color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.8, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry}
            </div>
          ))}
          {(tool.metadata!.entries as string[]).length > 10 && (
            <div style={{ fontSize: 10, color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.5, paddingTop: 2 }}>
              ... and {(tool.metadata!.entries as string[]).length - 10} more
            </div>
          )}
        </div>
      )}

      {tool.error && (
        <div style={{ paddingTop: 2, paddingBottom: 2, fontSize: 10, color: "var(--vscode-editorError-foreground, #f14c4c)" }}>
          Error: {tool.error}
        </div>
      )}
    </div>
  );
}

// ─── GroupRow ────────────────────────────────────────────────────────────────

function GroupRow({ group, now }: { group: ActivityGroup; now: number }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);

  const statusColor =
    group.status === "completed"
      ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
      : group.status === "failed"
      ? "var(--vscode-editorError-foreground, #f14c4c)"
      : "var(--vscode-progressBar-background, #0e70c0)";

  // Label based on the first tool in the group (or just fallback to Explored)
  const firstTool = group.items.find((i) => i.type === "tool") as { type: "tool"; tool: ToolActivity } | undefined;
  const label = firstTool ? getGroupLabel(firstTool.tool.toolName, firstTool.tool.args) : `Explored ${group.target}`;

  const statusIcon = group.status === "completed" ? <ToolIcon /> : group.status === "failed" ? <ErrorIcon /> : <RunningIcon />;

  const endTime = group.status === "running" ? now : group.endTime;
  const durationSec = endTime ? ((endTime - group.startTime) / 1000).toFixed(1) : null;

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "1px 0",
          width: "100%",
          textAlign: "left",
        }}
        aria-expanded={open}
      >
        <span style={{ color: statusColor, display: "flex", alignItems: "center", minWidth: 14, flexShrink: 0 }}>
          {statusIcon}
        </span>
        <span
          onClick={(e) => {
            const firstItem = group.items.find(i => i.type === 'tool' && i.tool.args);
            if (firstItem && firstItem.type === 'tool') {
              const { fullPath } = extractTarget(firstItem.tool.args);
              const toolName = firstItem.tool.toolName;
              if (fullPath && toolName !== 'list_directory' && toolName !== 'list_dir') {
                e.stopPropagation();
                (window as any).vscode?.postMessage({ type: "openFile", filepath: fullPath });
              }
            }
          }}
          className={(group.items.some(i => i.type === 'tool' && extractTarget(i.tool.args).fullPath && i.tool.toolName !== 'list_directory' && i.tool.toolName !== 'list_dir')) ? "hover:underline" : ""}
          style={{
            fontSize: 11,
            color: hover ? "var(--vscode-editor-foreground, #ffffff)" : "var(--vscode-descriptionForeground, #9d9d9d)",
            transition: "color 0.1s ease",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span style={{ color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: hover ? 0.8 : 0.5, display: "inline-flex", alignItems: "center", transition: "opacity 0.1s ease" }}>
          <Chevron open={open} />
        </span>
        <div style={{ flex: 1 }} />
        {durationSec && (
          <span style={{ fontSize: 10, color: hover ? "var(--vscode-editor-foreground, #ffffff)" : "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.6, flexShrink: 0, transition: "color 0.1s ease" }}>
            {durationSec}s
          </span>
        )}
      </button>

      {open && (
        <div style={{ paddingLeft: 16 }}>
          {group.items.map((item) => {
            if (item.type === "thought") {
              const et = item.endTime || now;
              const ds = ((et - item.startTime) / 1000).toFixed(1);
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "1px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.8 }}>
                    Thought
                  </span>
                  <span style={{ color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.5, display: "inline-flex", alignItems: "center" }}>
                    <Chevron open={false} />
                  </span>
                  <div style={{ flex: 1 }} />
                  {ds && (
                    <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: 0.6, flexShrink: 0 }}>
                      {ds}s
                    </span>
                  )}
                </div>
              );
            } else {
              // Avoid redundant inner label if it's the only item and perfectly matches the parent
              const innerLabel = getInnerLabel(item.tool);
              const hideLabel = group.items.length === 1 && innerLabel === label;
              if (hideLabel && !item.tool.error && !item.tool.metadata?.entries) return null;
              return <InnerToolRow key={item.tool.toolCallId} tool={item.tool} now={now} hideLabel={hideLabel} />;
            }
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

interface AgentActivityPanelProps {
  /** All activity messages for this turn. */
  activities: AgentActivityMessage[];
}

export function AgentActivityPanel({ activities }: AgentActivityPanelProps) {
  const [open, setOpen] = useState(true);
  const [hover, setHover] = useState(false);
  const [now, setNow] = useState(Date.now());

  // 1. Process flat list of root events
  let startTs: number | null = null;
  let runStatus: "running" | "completed" | "failed" | "cancelled" = "running";
  let totalDurationMs = 0;

  for (const msg of activities) {
    const ev = msg.event;
    if (ev.kind === "started") {
      startTs = ev.timestamp;
      runStatus = "running";
    } else if (ev.kind === "completed") {
      runStatus = "completed";
      totalDurationMs = ev.durationMs;
    } else if (ev.kind === "failed") {
      runStatus = "failed";
      totalDurationMs = ev.timestamp - (startTs ?? ev.timestamp);
    } else if (ev.kind === "cancelled") {
      runStatus = "cancelled";
      totalDurationMs = ev.timestamp - (startTs ?? ev.timestamp);
    }
  }

  // 2. Build entries (Thoughts and Tools)
  const entries: Entry[] = [];
  let currentThought: { type: "thought"; id: string; startTime: number; endTime?: number } | null = null;
  const toolMap = new Map<string, ToolActivity>();

  for (const msg of activities) {
    const ev = msg.event;
    if (ev.kind === "thinking") {
      if (currentThought && !currentThought.endTime) currentThought.endTime = ev.timestamp;
      currentThought = { type: "thought", id: `thought_${ev.timestamp}`, startTime: ev.timestamp };
      entries.push(currentThought);
    } else if (ev.kind === "tool_started") {
      if (currentThought && !currentThought.endTime) currentThought.endTime = ev.timestamp;
      currentThought = null;
      const t: ToolActivity = {
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        args: ev.args,
        startTime: ev.timestamp,
        status: "running",
      };
      toolMap.set(ev.toolCallId, t);
      entries.push({ type: "tool", tool: t });
    } else if (ev.kind === "tool_completed" || ev.kind === "tool_failed") {
      const t = toolMap.get(ev.toolCallId);
      if (t) {
        t.endTime = ev.timestamp;
        t.status = ev.kind === "tool_completed" ? "completed" : "failed";
        t.durationMs = ev.durationMs;
        if (ev.kind === "tool_failed") t.error = ev.error;
      }
    } else if (ev.kind === "completed" || ev.kind === "failed" || ev.kind === "cancelled") {
      if (currentThought && !currentThought.endTime) currentThought.endTime = ev.timestamp;
    }
  }

  // 3. Group entries by target
  const groups: ActivityGroup[] = [];
  let currentGroup: ActivityGroup | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let target = "";

    if (entry.type === "tool") {
      target = extractTarget(entry.tool.args).target;
    } else {
      // Find next tool to adopt its target context
      let nextTool: ToolActivity | null = null;
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].type === "tool") {
          nextTool = (entries[j] as { type: "tool"; tool: ToolActivity }).tool;
          break;
        }
      }
      if (nextTool) {
        target = extractTarget(nextTool.args).target;
      } else if (currentGroup) {
        target = currentGroup.target;
      }
    }

    if (!currentGroup || currentGroup.target !== target || !target) {
      currentGroup = {
        id: `group_${i}`,
        target: target || "task",
        toolName: entry.type === "tool" ? entry.tool.toolName : "thought",
        items: [],
        status: "completed", // will be updated below
        startTime: entry.type === "tool" ? entry.tool.startTime : entry.startTime,
      };
      groups.push(currentGroup);
    }

    currentGroup.items.push(entry);
    currentGroup.endTime = (entry.type === "tool" ? entry.tool.endTime : entry.endTime) || Date.now();

    // Group status cascades from running/failed items
    if (entry.type === "tool" && entry.tool.status === "running") currentGroup.status = "running";
    if (entry.type === "tool" && entry.tool.status === "failed" && currentGroup.status !== "running") {
      currentGroup.status = "failed";
    }
  }

  // Live elapsed timer while running
  useEffect(() => {
    if (runStatus !== "running" || !startTs) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => clearInterval(interval);
  }, [runStatus, startTs]);

  const elapsed = runStatus === "running" && startTs ? now - startTs : totalDurationMs;
  const elapsedSec = (elapsed / 1000).toFixed(elapsed >= 10000 ? 0 : 1);

  // Compact summary line
  const statusVerb =
    runStatus === "completed"
      ? "Worked"
      : runStatus === "failed"
      ? "Failed"
      : runStatus === "cancelled"
      ? "Cancelled"
      : "Working";

  if (activities.length === 0) {
    return null;
  }

  return (
    <div role="region" aria-label="Agent activity" style={{ marginBottom: 8, userSelect: "text" }}>
      {/* ── Collapsible header ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          fontSize: 12,
          fontWeight: 500,
        }}
        aria-expanded={open}
      >
        <span
          style={{
            color: hover ? "var(--vscode-editor-foreground, #ffffff)" : "var(--vscode-descriptionForeground, #9d9d9d)",
            transition: "color 0.1s ease",
          }}
        >
          {statusVerb} for {elapsedSec}s
        </span>
        <span style={{ color: "var(--vscode-descriptionForeground, #9d9d9d)", opacity: hover ? 0.8 : 0.5, display: "inline-flex", alignItems: "center", transition: "opacity 0.1s ease" }}>
          <Chevron open={open} />
        </span>
        {runStatus === "running" && (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "var(--vscode-progressBar-background, #0e70c0)",
              marginLeft: 2,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
        )}
      </button>

      {/* ── Expanded content ───────────────────────────────────────── */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: open ? 2000 : 0,
          opacity: open ? 1 : 0,
          transition: "max-height 200ms ease, opacity 150ms ease",
        }}
        aria-hidden={!open}
      >
        <div style={{ paddingLeft: 15, paddingTop: 4, paddingBottom: 4 }}>
          {groups.length === 0 && runStatus === "running" && (
            <div
              style={{
                fontSize: 11,
                color: "var(--vscode-descriptionForeground, #9d9d9d)",
                opacity: 0.7,
                fontStyle: "italic",
              }}
            >
              Thinking…
            </div>
          )}

          {groups.map((group) => (
            <GroupRow key={group.id} group={group} now={now} />
          ))}

          {(runStatus === "failed" || runStatus === "cancelled") && (
            <div
              style={{
                fontSize: 11,
                color:
                  runStatus === "failed"
                    ? "var(--vscode-editorError-foreground, #f14c4c)"
                    : "var(--vscode-descriptionForeground, #9d9d9d)",
                marginTop: 2,
                opacity: 0.85,
              }}
            >
              {runStatus === "failed" ? "✗ Failed" : "◌ Cancelled"}
            </div>
          )}
        </div>
      </div>

      {/* Inline keyframe for the running pulse dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
