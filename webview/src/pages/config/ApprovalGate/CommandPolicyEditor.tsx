// Modal editor dialog for creating or editing terminal command approval rules.
import React, { useState, useEffect } from "react";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  FolderIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ApprovalPolicy, PolicyScope } from "./types";

interface CommandPolicyEditorProps {
  isOpen: boolean;
  editingPolicy?: ApprovalPolicy | null;
  existingPolicies: ApprovalPolicy[];
  onClose: () => void;
  onSave: (data: {
    commandPattern: string;
    scope: PolicyScope;
    description: string;
    ruleType: "exact" | "pattern";
    id?: string;
  }) => Promise<void> | void;
  isSaving: boolean;
}

// Checks if a command string contains dangerous compound shell operators.
function isCompoundCommand(cmd: string): boolean {
  if (/[\r\n]/.test(cmd)) return true;
  const unquoted = cmd.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return /(&&|\|\||[;&|]|>{1,2}|<|\$\(|\`)/.test(unquoted);
}

// Checks if a command string has unbalanced quotation marks.
function hasUnbalancedQuotes(cmd: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') inDouble = false;
      continue;
    }
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      continue;
    }
  }

  return inSingle || inDouble || escape;
}

// Renders the modal editor for adding or modifying an approval policy with strict allowance choices.
export function CommandPolicyEditor({
  isOpen,
  editingPolicy,
  existingPolicies,
  onClose,
  onSave,
  isSaving,
}: CommandPolicyEditorProps) {
  const isEditing = Boolean(editingPolicy);

  const [commandPattern, setCommandPattern] = useState("");
  const [scope, setScope] = useState<PolicyScope>("global");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initialize or reset form state when editing target changes
  useEffect(() => {
    if (editingPolicy) {
      setCommandPattern(editingPolicy.commandPattern);
      setScope(editingPolicy.scope);
      setDescription(editingPolicy.description || "");
      setError(null);
    } else {
      setCommandPattern("");
      setScope("global");
      setDescription("");
      setError(null);
    }
  }, [editingPolicy, isOpen]);

  if (!isOpen) {
    return null;
  }

  // Validates inputs and triggers the persistence callback
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedCommand = commandPattern.trim();
    if (!trimmedCommand) {
      setError("Command pattern cannot be empty.");
      return;
    }

    if (isCompoundCommand(trimmedCommand)) {
      setError("Chained or compound commands (&&, ||, ;, pipes) are prohibited for safety.");
      return;
    }

    if (hasUnbalancedQuotes(trimmedCommand)) {
      setError("Command has unbalanced quotes or dangling escape characters.");
      return;
    }

    // Check for duplicate policy in the same scope
    const isDuplicate = existingPolicies.some(
      (p) =>
        p.id !== editingPolicy?.id &&
        p.scope === scope &&
        p.commandPattern.trim().toLowerCase() === trimmedCommand.toLowerCase()
    );

    if (isDuplicate) {
      setError(`A policy for "${trimmedCommand}" already exists in ${scope} scope.`);
      return;
    }

    const ruleType = trimmedCommand.includes("*") ? "pattern" : "exact";
    const autoDesc =
      description.trim() ||
      (scope === "global"
        ? `Always allow globally: "${trimmedCommand}"`
        : `Always allow in workspace: "${trimmedCommand}"`);

    await onSave({
      commandPattern: trimmedCommand,
      scope,
      description: autoDesc,
      ruleType,
      id: editingPolicy?.id,
    });
  };

  const labelClass =
    "mb-1.5 block p-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8B96A9]";

  const inputClass = `
  box-border h-10 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#0A0D13] px-3
  text-[13px] text-[#F1F5F9] outline-none placeholder:text-[#5E6A7E]
  transition-colors duration-150
  hover:border-white/[0.16]
  focus:border-[#2F48A1] focus:ring-2 focus:ring-[#2F48A1]/30
  disabled:cursor-not-allowed disabled:opacity-50
`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-editor-title"
      className="
        fixed inset-0 z-50 flex items-end justify-center
        bg-black/70 p-0 backdrop-blur-sm
        sm:items-center sm:p-4
      "
    >
      <div
        className="
          relative flex max-h-[92vh] w-full max-w-[560px] flex-col
          overflow-hidden rounded-t-2xl border border-white/[0.08] bg-[#0D1017]
          shadow-[0_24px_64px_rgba(0,0,0,0.6)]
          [&_*]:box-border
          sm:rounded-2xl
        "
      >
        {/* Soft glow */}
        <div
          aria-hidden="true"
          className="
            pointer-events-none absolute -left-10 -top-20 h-40 w-64
            rounded-full bg-[#2F48A1]/20 blur-3xl
          "
        />

        {/* Header */}
        <div className="relative flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.06] p-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3.5">
            <div
              className="
                flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
                bg-[#2F48A1]/15 text-[#7C93E8]
                ring-1 ring-inset ring-[#2F48A1]/30
                shadow-[0_0_20px_-6px_rgba(47,72,161,0.6)]
              "
            >
              <ShieldCheckIcon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <h3
                id="policy-editor-title"
                className="m-0 text-[16px] font-semibold leading-6 tracking-[-0.015em] text-[#F1F5F9]"
              >
                {isEditing ? "Edit Command Policy" : "Add Command Policy"}
              </h3>
              <p className="m-0 mt-0.5 text-[12.5px] leading-5 text-[#8B96A9]">
                Configure pre-approved terminal execution allowance.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close dialog"
            className="
              flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
              border-0 bg-transparent text-[#8B96A9]
              transition-colors duration-150
              hover:bg-white/[0.06] hover:text-[#F1F5F9]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="relative flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-5 sm:px-6">
            {/* Validation Error Alert */}
            {error && (
              <div
                role="alert"
                className="
                  flex items-start gap-2.5 rounded-lg
                  border border-red-500/25 bg-red-500/[0.07]
                  px-3.5 py-3 text-[12.5px] leading-5 text-red-300
                "
              >
                <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="min-w-0 break-words">{error}</div>
              </div>
            )}

            {/* Command Pattern Input */}
            <div>
              <label htmlFor="command-pattern-input" className={labelClass}>
                Command Pattern <span className="text-red-400">*</span>
              </label>
              <input
                id="command-pattern-input"
                data-testid="policy-command-input"
                type="text"
                value={commandPattern}
                onChange={(e) => setCommandPattern(e.target.value)}
                placeholder="e.g. npm test, git status, cargo check*"
                disabled={isSaving}
                autoFocus
                className={`${inputClass} font-mono text-[12.5px]`}
              />
              <p className="m-0 mt-2 text-[11.5px] leading-5 text-[#7A869A]">
                Enter an exact command or use wildcard{" "}
                <code className="rounded bg-[#2F48A1]/20 px-1 py-0.5 font-mono text-[#9DB0F0]">
                  *
                </code>{" "}
                for arguments. Chained commands (
                <code className="font-mono text-red-400">&amp;&amp;</code>,{" "}
                <code className="font-mono text-red-400">;</code>,{" "}
                <code className="font-mono text-red-400">|</code>) are
                prohibited.
              </p>
            </div>

            {/* Allowance Scope */}
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className={labelClass}>
                Allowance Scope <span className="text-red-400">*</span>
              </legend>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Global Option */}
                <label
                  className={`
                    group relative flex min-w-0 cursor-pointer items-start gap-3
                    rounded-xl border p-3.5 transition-all duration-150
                    focus-within:ring-2 focus-within:ring-[#2F48A1]/60
                    ${scope === "global"
                      ? "border-[#2F48A1]/60 bg-[#2F48A1]/[0.14] shadow-[0_0_20px_-8px_rgba(47,72,161,0.7)]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="allowance-scope"
                    value="global"
                    checked={scope === "global"}
                    onChange={() => setScope("global")}
                    disabled={isSaving}
                    className="sr-only"
                  />
                  <div
                    className={`
                      flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                      transition-colors duration-150
                      ${scope === "global"
                        ? "bg-[#2F48A1] text-white"
                        : "bg-white/[0.05] text-[#8B96A9] ring-1 ring-inset ring-white/[0.08]"
                      }
                    `}
                  >
                    <GlobeAltIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[#F1F5F9]">
                      Global Allowance
                    </span>
                    <p className="m-0 mt-0.5 text-[11.5px] leading-[18px] text-[#8B96A9]">
                      Always pre-approve across all projects on this system.
                    </p>
                  </div>
                  {scope === "global" && (
                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-[#8FA5F0]" />
                  )}
                </label>

                {/* Workspace Option */}
                <label
                  className={`
                    group relative flex min-w-0 cursor-pointer items-start gap-3
                    rounded-xl border p-3.5 transition-all duration-150
                    focus-within:ring-2 focus-within:ring-emerald-500/50
                    ${scope === "workspace"
                      ? "border-emerald-500/50 bg-emerald-500/[0.1] shadow-[0_0_20px_-8px_rgba(16,185,129,0.6)]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="allowance-scope"
                    value="workspace"
                    checked={scope === "workspace"}
                    onChange={() => setScope("workspace")}
                    disabled={isSaving}
                    className="sr-only"
                  />
                  <div
                    className={`
                      flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                      transition-colors duration-150
                      ${scope === "workspace"
                        ? "bg-emerald-500 text-white"
                        : "bg-white/[0.05] text-[#8B96A9] ring-1 ring-inset ring-white/[0.08]"
                      }
                    `}
                  >
                    <FolderIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[#F1F5F9]">
                      Workspace Allowance
                    </span>
                    <p className="m-0 mt-0.5 text-[11.5px] leading-[18px] text-[#8B96A9]">
                      Pre-approve only when running inside the active workspace.
                    </p>
                  </div>
                  {scope === "workspace" && (
                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />
                  )}
                </label>
              </div>
            </fieldset>

            {/* Optional Description */}
            <div>
              <label htmlFor="policy-description-input" className={labelClass}>
                Description / Notes{" "}
                <span className="font-normal normal-case tracking-normal text-[#5E6A7E]">
                  (optional)
                </span>
              </label>
              <input
                id="policy-description-input"
                data-testid="policy-description-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Unit test verification runner"
                disabled={isSaving}
                className={inputClass}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div
            className="
              flex shrink-0 flex-col-reverse gap-2.5
              border-t border-white/[0.06] bg-white/[0.02] p-4
              sm:flex-row sm:items-center sm:justify-end sm:px-6
            "
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="
                inline-flex h-10 w-full items-center justify-center
                rounded-lg border border-white/[0.1] bg-transparent px-5
                text-[12.5px] font-medium text-[#B8C2D4]
                transition-colors duration-150
                hover:bg-white/[0.06] hover:text-[#F1F5F9]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
                disabled:cursor-not-allowed disabled:opacity-50
                sm:w-auto
              "
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSaving || !commandPattern.trim()}
              data-testid="submit-policy-btn"
              className="
                inline-flex h-10 w-full items-center justify-center gap-2
                rounded-lg border-0 bg-[#2F48A1] px-5
                text-[12.5px] font-medium text-white
                shadow-md shadow-[#2F48A1]/30
                transition-all duration-200
                hover:-translate-y-px hover:bg-[#3A57C2]
                active:translate-y-0 active:scale-[0.98]
                focus:outline-none
                focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
                focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
                disabled:translate-y-0 disabled:cursor-not-allowed
                disabled:bg-[#2F48A1]/40 disabled:text-white/60 disabled:shadow-none
                sm:w-auto
              "
            >
              {isSaving && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
              )}
              {isSaving
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Add Command Policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
