// Collapsible agent execution activity panel tracking tool calls and thinking timeline.
/**
 * AgentActivityPanel — "Worked for Xs" collapsible activity section.
 *
 * Driven entirely by real agentActivity IPC messages from the extension host.
 * Groups tools and thoughts by the resource they explore.
 */

import { useEffect, useRef, useState } from "react";
import {
  WrenchScrewdriverIcon,
  XMarkIcon,
  EllipsisHorizontalIcon,
  SparklesIcon,
  ExclamationCircleIcon,
  StopIcon,
  CommandLineIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import { formatDuration } from "../../util/time";

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

function extractCommand(args?: Record<string, unknown>): string {
  if (!args) return "";
  const cmd = (args.command ?? args.CommandLine ?? args.cmd ?? args.input ?? "") as string;
  return typeof cmd === "string" ? cmd.trim() : "";
}

function isCommandTool(toolName: string): boolean {
  const name = (toolName || "").toLowerCase();
  return (
    name === "run_command" ||
    name === "terminal" ||
    name === "start_process" ||
    name === "terminal_run" ||
    name === "execute_command" ||
    name === "send_process_input" ||
    name === "bash" ||
    name === "shell"
  );
}

function extractTarget(args?: Record<string, unknown>, toolName?: string): { target: string; fullPath: string; command?: string } {
  if (toolName && isCommandTool(toolName)) {
    const cmd = extractCommand(args);
    return {
      target: cmd ? (cmd.length > 35 ? `${cmd.slice(0, 32)}...` : cmd) : "command",
      fullPath: "",
      command: cmd,
    };
  }
  const fp = (args?.filepath ?? args?.file ?? args?.path ?? args?.targetFile ?? args?.directory ?? args?.DirectoryPath ?? args?.AbsolutePath ?? args?.TargetFile ?? args?.SearchPath ?? "") as string;
  let target = fp;
  if (fp) {
    const parts = fp.split(/[/\\]/).filter(Boolean);
    target = parts.length > 2 ? parts.slice(-2).join("/") : (parts.pop() || fp);
  }
  return { target: target || "", fullPath: fp, command: extractCommand(args) };
}

interface ToolLabelInfo {
  title: string;
  command?: string;
}

function getGroupLabel(toolName: string, args?: Record<string, unknown>): ToolLabelInfo {
  if (isCommandTool(toolName)) {
    const cmd = extractCommand(args);
    if (cmd) {
      return { title: "Ran command", command: cmd };
    }
    return { title: "Ran command" };
  }
  const { target } = extractTarget(args, toolName);
  if (toolName === "list_directory" || toolName === "list_dir") {
    let t = target || "directory";
    if (t !== "directory" && !t.endsWith("/")) t += "/";
    return { title: `Explored ${t}` };
  }
  if (toolName === "read_file" || toolName === "view_file" || toolName === "grep_search") {
    return { title: `Explored ${target || "file"}` };
  }
  if (toolName === "edit_file" || toolName === "create_file" || toolName === "write_to_file" || toolName === "replace_file_content" || toolName === "multi_replace_file_content") {
    return { title: `Edited ${target || "file"}` };
  }
  if (toolName === "search_web") {
    return { title: `Searched web` };
  }
  return { title: `Used ${toolName}` };
}

function getInnerLabel(tool: ToolActivity): ToolLabelInfo {
  if (isCommandTool(tool.toolName)) {
    const cmd = extractCommand(tool.args);
    const verb = tool.status === "running" ? "Running command" : "Ran command";
    if (cmd) {
      return { title: verb, command: cmd };
    }
    return { title: verb };
  }
  const { target } = extractTarget(tool.args, tool.toolName);
  if (tool.toolName === "read_file" || tool.toolName === "view_file" || tool.toolName === "grep_search") {
    const start = (tool.metadata?.startLine ?? tool.args?.startLine ?? tool.args?.StartLine) as number | undefined;
    const end = (tool.metadata?.endLine ?? tool.args?.endLine ?? tool.args?.EndLine) as number | undefined;
    const range = start && end ? `#L${start}-${end}` : (start ? `#L${start}-` : "");
    return { title: `Analyzed ${target || "file"}${range}` };
  }
  if (tool.toolName === "list_directory" || tool.toolName === "list_dir") {
    let t = target || "directory";
    if (t !== "directory" && !t.endsWith("/")) t += "/";
    return { title: `Explored ${t}` };
  }
  if (tool.toolName === "edit_file" || tool.toolName === "create_file" || tool.toolName === "write_to_file" || tool.toolName === "replace_file_content" || tool.toolName === "multi_replace_file_content") {
    return { title: `Edited ${target || "file"}` };
  }
  return { title: `Ran ${tool.toolName}` };
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

// ─── Command Card ────────────────────────────────────────────────────────────

function CommandCard({ tool }: { tool: ToolActivity }) {
  const [copied, setCopied] = useState(false);
  const command = extractCommand(tool.args);
  const cwd = (tool.args?.cwd ?? tool.args?.Cwd ?? "") as string;
  const execId = (tool.metadata?.executionId as string) || (tool.args?.executionId as string) || "";
  const exitCode = tool.metadata?.exitCode as number | undefined;
  const output = (tool.metadata?.output ?? tool.metadata?.stdout ?? "") as string;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!command) return;
    navigator.clipboard?.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevealTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    (window as any).vscode?.postMessage({
      type: "revealTerminal",
      executionId: execId,
    });
  };

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 6,
        padding: "8px 10px",
        borderRadius: 6,
        backgroundColor: "var(--vscode-terminal-background, #141820)",
        border: "1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08))",
        fontSize: 11,
        fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--vscode-descriptionForeground, #8b949e)",
            fontWeight: 600,
          }}
        >
          Terminal Command
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {exitCode !== undefined && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 4,
                backgroundColor: exitCode === 0 ? "rgba(78, 201, 176, 0.15)" : "rgba(241, 76, 76, 0.15)",
                color: exitCode === 0 ? "var(--vscode-terminal-ansiGreen, #4ec9b0)" : "var(--vscode-editorError-foreground, #f14c4c)",
                fontWeight: 600,
              }}
            >
              exit {exitCode}
            </span>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy command"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              color: copied ? "var(--vscode-terminal-ansiGreen, #4ec9b0)" : "var(--vscode-descriptionForeground, #9d9d9d)",
              cursor: "pointer",
              padding: "1px 4px",
              borderRadius: 3,
              fontSize: 10,
            }}
          >
            {copied ? (
              <>
                <CheckIcon style={{ width: 11, height: 11 }} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <ClipboardDocumentIcon style={{ width: 11, height: 11 }} />
                <span>Copy</span>
              </>
            )}
          </button>
          {(tool.toolName === "terminal" || execId) && (
            <button
              type="button"
              onClick={handleRevealTerminal}
              title="Open terminal in VS Code"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                background: "transparent",
                border: "none",
                color: "var(--vscode-textLink-foreground, #40a9ff)",
                cursor: "pointer",
                padding: "1px 4px",
                borderRadius: 3,
                fontSize: 10,
              }}
            >
              <ArrowTopRightOnSquareIcon style={{ width: 11, height: 11 }} />
              <span>Terminal</span>
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          color: "var(--vscode-terminal-foreground, #e2e8f0)",
          wordBreak: "break-all",
          whiteSpace: "pre-wrap",
          lineHeight: 1.45,
          userSelect: "all",
        }}
      >
        <span
          style={{
            color: "var(--vscode-terminal-ansiGreen, #4ec9b0)",
            fontWeight: "bold",
            userSelect: "none",
            flexShrink: 0,
          }}
        >
          $
        </span>
        <span style={{ fontWeight: 500 }}>{command || "(No command specified)"}</span>
      </div>

      {cwd && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            color: "var(--vscode-descriptionForeground, #8b949e)",
            userSelect: "none",
          }}
        >
          Directory: <span style={{ color: "var(--vscode-editor-foreground, #cccccc)" }}>{cwd}</span>
        </div>
      )}

      {output && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 4,
            borderTop: "1px dashed var(--vscode-widget-border, rgba(255, 255, 255, 0.08))",
            maxHeight: 120,
            overflowY: "auto",
            fontSize: 10,
            color: "var(--vscode-descriptionForeground, #9d9d9d)",
            whiteSpace: "pre-wrap",
          }}
        >
          {output.slice(0, 500)}
          {output.length > 500 && `\n... (${output.length - 500} more characters)`}
        </div>
      )}
    </div>
  );
}

// ─── InnerToolRow ────────────────────────────────────────────────────────────

function InnerToolRow({ tool, now, hideLabel }: { tool: ToolActivity; now: number; hideLabel?: boolean }) {
  const endTime = tool.status === "running" ? now : tool.endTime;
  const durationSec = endTime ? ((endTime - tool.startTime) / 1000).toFixed(1) : null;
  const labelInfo = getInnerLabel(tool);
  const isCmd = isCommandTool(tool.toolName) || Boolean(extractCommand(tool.args));

  if (isCmd) {
    return <CommandCard tool={tool} />;
  }

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
              if (tool.toolName === 'terminal') {
                const execId = (tool.metadata?.executionId as string) || (tool.args?.executionId as string) || '';
                (window as any).vscode?.postMessage({ type: "revealTerminal", executionId: execId });
                return;
              }
              const { fullPath } = extractTarget(tool.args, tool.toolName);
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
              cursor: (tool.toolName === 'terminal' || (extractTarget(tool.args, tool.toolName).fullPath && tool.toolName !== 'list_directory' && tool.toolName !== 'list_dir')) ? "pointer" : "default",
            }}
            className={(tool.toolName === 'terminal' || (extractTarget(tool.args, tool.toolName).fullPath && tool.toolName !== 'list_directory' && tool.toolName !== 'list_dir')) ? "hover:underline hover:text-[var(--vscode-foreground,#cccccc)] transition-colors" : ""}
            title={tool.toolName === 'terminal' ? "Click to reveal terminal in VS Code" : undefined}
          >
            {labelInfo.title}
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
  const firstTool = group.items.find((i) => i.type === "tool") as { type: "tool"; tool: ToolActivity } | undefined;
  const isCmdGroup = firstTool ? (isCommandTool(firstTool.tool.toolName) || Boolean(extractCommand(firstTool.tool.args))) : false;
  const [open, setOpen] = useState(() => isCmdGroup);
  const [hover, setHover] = useState(false);

  const statusColor =
    group.status === "completed"
      ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
      : group.status === "failed"
      ? "var(--vscode-editorError-foreground, #f14c4c)"
      : "var(--vscode-progressBar-background, #0e70c0)";

  const labelInfo = firstTool
    ? getGroupLabel(firstTool.tool.toolName, firstTool.tool.args)
    : { title: `Explored ${group.target}` };

  const statusIcon =
    group.status === "completed"
      ? (isCmdGroup ? <CommandLineIcon style={{ width: 12, height: 12, flexShrink: 0 }} /> : <ToolIcon />)
      : group.status === "failed"
      ? <ErrorIcon />
      : <RunningIcon />;

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
              const toolName = firstItem.tool.toolName;
              if (toolName === 'terminal' || toolName === 'run_command') {
                e.stopPropagation();
                const execId = (firstItem.tool.metadata?.executionId as string) || (firstItem.tool.args?.executionId as string) || '';
                (window as any).vscode?.postMessage({ type: "revealTerminal", executionId: execId });
                return;
              }
              const { fullPath } = extractTarget(firstItem.tool.args, toolName);
              if (fullPath && toolName !== 'list_directory' && toolName !== 'list_dir') {
                e.stopPropagation();
                (window as any).vscode?.postMessage({ type: "openFile", filepath: fullPath });
              }
            }
          }}
          className={(group.items.some(i => i.type === 'tool' && (i.tool.toolName === 'terminal' || i.tool.toolName === 'run_command' || (extractTarget(i.tool.args, i.tool.toolName).fullPath && i.tool.toolName !== 'list_directory' && i.tool.toolName !== 'list_dir')))) ? "hover:underline cursor-pointer" : ""}
          title={(group.items.some(i => i.type === 'tool' && (i.tool.toolName === 'terminal' || i.tool.toolName === 'run_command'))) ? "Click to reveal terminal in VS Code" : undefined}
          style={{
            fontSize: 11,
            color: hover ? "var(--vscode-editor-foreground, #ffffff)" : "var(--vscode-descriptionForeground, #9d9d9d)",
            transition: "color 0.1s ease",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span>{labelInfo.title}</span>
          {labelInfo.command && (
            <code
              style={{
                fontFamily: "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
                fontSize: 10.5,
                padding: "1px 6px",
                borderRadius: 4,
                backgroundColor: "var(--vscode-badge-background, rgba(255, 255, 255, 0.08))",
                color: "var(--vscode-terminal-ansiGreen, #4ec9b0)",
                border: "1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "70%",
              }}
              title={labelInfo.command}
            >
              $ {labelInfo.command}
            </code>
          )}
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
              const innerLabelInfo = getInnerLabel(item.tool);
              const isCmdItem = isCommandTool(item.tool.toolName) || Boolean(extractCommand(item.tool.args));
              // Avoid redundant inner label if it's the only non-command item and perfectly matches the parent
              const hideLabel = group.items.length === 1 && innerLabelInfo.title === labelInfo.title && !isCmdItem;
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
  /** Whether the generation for this message is currently active. */
  isStreaming?: boolean;
}

export function AgentActivityPanel({ activities, isStreaming = false }: AgentActivityPanelProps) {
  const [open, setOpen] = useState(() => Boolean(isStreaming));
  const [hover, setHover] = useState(false);
  const [now, setNow] = useState(Date.now());
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

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

  // If generation is no longer streaming and no terminal activity was recorded,
  // reconcile state so panel does not stay stuck in "running" / "Thinking...".
  if (!isStreaming && runStatus === "running") {
    runStatus = "completed";
    if (startTs) {
      totalDurationMs = Math.max(0, now - startTs);
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
        metadata: { executionId: msg.executionId },
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
      target = extractTarget(entry.tool.args, entry.tool.toolName).target;
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
        target = extractTarget(nextTool.args, nextTool.toolName).target;
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

  // Live elapsed timer while genuinely running and streaming
  useEffect(() => {
    if (runStatus !== "running" || !isStreaming || !startTs) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [runStatus, isStreaming, startTs]);

  const elapsed = runStatus === "running" && startTs ? now - startTs : totalDurationMs;
  const durationText = formatDuration(elapsed / 1000);

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
    <div
      role="region"
      aria-label="Agent activity"
      style={{
        marginTop: 2,
        marginBottom: open ? 6 : 2,
        marginLeft: 8,
        marginRight: 8,
        userSelect: "text",
      }}
    >
      {/* ── Collapsible header pill ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: hover
            ? "var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.08))"
            : "var(--vscode-badge-background, rgba(255, 255, 255, 0.04))",
          border: "1px solid",
          borderColor: hover
            ? "var(--vscode-focusBorder, rgba(255, 255, 255, 0.2))"
            : "var(--vscode-widget-border, rgba(255, 255, 255, 0.08))",
          borderRadius: 14,
          cursor: "pointer",
          padding: "2.5px 9px 2.5px 7px",
          fontSize: 11.5,
          fontWeight: 500,
          color: hover
            ? "var(--vscode-editor-foreground, #ffffff)"
            : "var(--vscode-descriptionForeground, #9d9d9d)",
          transition: "all 0.15s ease",
          boxShadow: hover ? "0 1px 3px rgba(0, 0, 0, 0.15)" : "none",
        }}
        aria-expanded={open}
        title={open ? "Click to collapse agent activity" : "Click to view agent activity"}
      >
        {/* Status indicator icon */}
        {runStatus === "running" ? (
          <svg
            style={{
              width: 12,
              height: 12,
              animation: "activity-spin 0.9s linear infinite",
              color: "var(--vscode-progressBar-background, #3b82f6)",
              flexShrink: 0,
            }}
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : runStatus === "completed" ? (
          <SparklesIcon
            style={{
              width: 12,
              height: 12,
              color: "#a78bfa",
              flexShrink: 0,
            }}
          />
        ) : runStatus === "failed" ? (
          <ExclamationCircleIcon
            style={{
              width: 12,
              height: 12,
              color: "var(--vscode-editorError-foreground, #f14c4c)",
              flexShrink: 0,
            }}
          />
        ) : (
          <StopIcon
            style={{
              width: 12,
              height: 12,
              color: "var(--vscode-descriptionForeground, #9d9d9d)",
              flexShrink: 0,
            }}
          />
        )}

        <span>
          {statusVerb} for {durationText}
        </span>

        <span
          style={{
            color: "var(--vscode-descriptionForeground, #9d9d9d)",
            opacity: hover ? 0.9 : 0.6,
            display: "inline-flex",
            alignItems: "center",
            transition: "opacity 0.15s ease",
          }}
        >
          <Chevron open={open} />
        </span>
      </button>

      {/* ── Expanded content ───────────────────────────────────────── */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: open ? 2000 : 0,
          opacity: open ? 1 : 0,
          transition: "max-height 200ms ease, opacity 150ms ease",
          marginTop: open ? 4 : 0,
        }}
        aria-hidden={!open}
      >
        <div style={{ paddingLeft: 10, paddingTop: open ? 4 : 0, paddingBottom: open ? 4 : 0 }}>
          {groups.length === 0 && runStatus === "running" && isStreaming && (
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

          {groups.length === 0 && runStatus === "completed" && (
            <div
              style={{
                fontSize: 11,
                color: "var(--vscode-descriptionForeground, #9d9d9d)",
                opacity: 0.6,
                fontStyle: "italic",
              }}
            >
              Direct response (no tool calls)
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

      {/* Inline keyframes */}
      <style>{`
        @keyframes activity-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
