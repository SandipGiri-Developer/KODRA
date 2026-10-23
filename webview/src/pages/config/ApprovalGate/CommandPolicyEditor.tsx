import React, { useState, useEffect } from "react";
import {
  GlobeAltIcon,
  FolderIcon,
  XMarkIcon,
  ExclamationCircleIcon,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div
        className="
          relative w-full max-w-[540px] rounded-xl border border-[#262D3E]
          bg-[#0E1118] p-6 shadow-2xl transition-all
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#1E2333]">
          <div>
            <h3
              id="policy-editor-title"
              className="text-[17px] font-semibold text-[#F1F5F9] m-0"
            >
              {isEditing ? "Edit Command Policy" : "Add Command Policy"}
            </h3>
            <p className="mt-1 text-[12px] text-[#7A889B] m-0">
              Configure pre-approved terminal execution allowance.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close dialog"
            className="
              rounded-md p-1.5 text-[#64748B] transition-colors
              hover:bg-[#1E2333] hover:text-[#E2E8F0] focus:outline-none focus:ring-1 focus:ring-[#6366F1]
            "
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Validation Error Alert */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 p-3 text-[12px] text-[#FCA5A5]"
            >
              <ExclamationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#EF4444]" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {/* Command Pattern Input */}
          <div>
            <label
              htmlFor="command-pattern-input"
              className="block text-[12px] font-medium text-[#C7D0DD] mb-1.5"
            >
              Command Pattern <span className="text-[#EF4444]">*</span>
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
              className="
                w-full rounded-lg border border-[#262D3E] bg-[#0A0C10] px-3 py-2.5
                font-mono text-[13px] text-[#F1F5F9] placeholder-[#556075] transition-colors
                focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[#6366F1]
                disabled:opacity-50
              "
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#727F93] m-0">
              Enter an exact command or use wildcard <code className="text-[#818CF8] bg-[#161A26] px-1 rounded">*</code> for arguments. Chained commands (<code className="text-[#EF4444]">&amp;&amp;</code>, <code className="text-[#EF4444]">;</code>, <code className="text-[#EF4444]">|</code>) are prohibited.
            </p>
          </div>

          {/* Allowance Choice (Strictly Global or Workspace) */}
          <div>
            <label className="block text-[12px] font-medium text-[#C7D0DD] mb-2">
              Allowance Scope <span className="text-[#EF4444]">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Global Option */}
              <label
                className={`
                  relative flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all
                  ${
                    scope === "global"
                      ? "border-[#6366F1] bg-[#6366F1]/10 shadow-[0_0_15px_rgba(99,102,241,0.12)]"
                      : "border-[#1E2333] bg-[#0A0C10] hover:border-[#2A3144] hover:bg-[#12151E]"
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
                    mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border
                    ${
                      scope === "global"
                        ? "border-[#6366F1] bg-[#6366F1] text-white"
                        : "border-[#2A3144] bg-[#151923] text-[#7A889B]"
                    }
                  `}
                >
                  <GlobeAltIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#E2E8F0]">
                      Global Allowance
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#7A889B] m-0">
                    Always pre-approve across all projects on this system.
                  </p>
                </div>
              </label>

              {/* Workspace Option */}
              <label
                className={`
                  relative flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all
                  ${
                    scope === "workspace"
                      ? "border-[#10B981] bg-[#10B981]/10 shadow-[0_0_15px_rgba(16,185,129,0.12)]"
                      : "border-[#1E2333] bg-[#0A0C10] hover:border-[#2A3144] hover:bg-[#12151E]"
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
                    mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border
                    ${
                      scope === "workspace"
                        ? "border-[#10B981] bg-[#10B981] text-white"
                        : "border-[#2A3144] bg-[#151923] text-[#7A889B]"
                    }
                  `}
                >
                  <FolderIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#E2E8F0]">
                      Workspace Allowance
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#7A889B] m-0">
                    Pre-approve only when running inside the active workspace.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Optional Description */}
          <div>
            <label
              htmlFor="policy-description-input"
              className="block text-[12px] font-medium text-[#C7D0DD] mb-1.5"
            >
              Description / Notes <span className="text-[#556075] text-[11px] font-normal">(optional)</span>
            </label>
            <input
              id="policy-description-input"
              data-testid="policy-description-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Unit test verification runner"
              disabled={isSaving}
              className="
                w-full rounded-lg border border-[#262D3E] bg-[#0A0C10] px-3 py-2.5
                text-[12px] text-[#F1F5F9] placeholder-[#556075] transition-colors
                focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[#6366F1]
                disabled:opacity-50
              "
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1E2333]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="
                inline-flex min-h-[38px] items-center justify-center rounded-lg border
                border-[#2A3143] bg-[#151923] px-4 text-[12px] font-medium text-[#C7D0DD]
                transition-colors hover:border-[#3D4760] hover:bg-[#1D2230] hover:text-[#FFFFFF]
                focus:outline-none focus:ring-1 focus:ring-[#6366F1] disabled:opacity-50
              "
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !commandPattern.trim()}
              data-testid="submit-policy-btn"
              className="
                inline-flex min-h-[38px] items-center justify-center rounded-lg border
                border-[#6366F1] bg-[#4F46E5] px-5 text-[12px] font-medium text-white
                shadow-sm transition-all hover:border-[#4F46E5] hover:bg-[#4338CA]
                focus:outline-none focus:ring-2 focus:ring-[#6366F1]/40 disabled:cursor-not-allowed disabled:opacity-50
              "
            >
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
