import React from "react";
import {
  GlobeAltIcon,
  FolderIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { ApprovalPolicy } from "./types";

interface CommandPolicyRowProps {
  policy: ApprovalPolicy;
  onEdit: (policy: ApprovalPolicy) => void;
  onDelete: (policy: ApprovalPolicy) => void;
  onToggleEnable: (policy: ApprovalPolicy, enabled: boolean) => void;
}

// Renders an individual command policy card with allowance status, rule details, and action triggers.
export function CommandPolicyRow({
  policy,
  onEdit,
  onDelete,
  onToggleEnable,
}: CommandPolicyRowProps) {
  const isGlobal = policy.scope === "global";
  const isDeny = policy.decision === "deny";

  return (
    <div
      data-testid={`policy-row-${policy.id}`}
      className={`
        group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4
        rounded-xl border p-4 transition-all duration-150
        ${
          policy.enabled
            ? "border-[#1E2333] bg-[#0E1118] hover:border-[#2D354A] hover:bg-[#121620]"
            : "border-[#1A1F2C] bg-[#0A0C10] opacity-60 hover:opacity-80"
        }
      `}
    >
      {/* Left: Checkbox + Command info */}
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        {/* Enable / Disable Toggle Checkbox */}
        <div className="pt-0.5">
          <input
            type="checkbox"
            id={`toggle-policy-${policy.id}`}
            aria-label={`Enable policy for ${policy.commandPattern}`}
            checked={policy.enabled}
            onChange={(e) => onToggleEnable(policy, e.target.checked)}
            className="
              h-4 w-4 rounded border-[#2E364A] bg-[#0C0E14] text-[#6366F1]
              focus:ring-1 focus:ring-[#6366F1] focus:ring-offset-0 cursor-pointer
            "
          />
        </div>

        {/* Command pattern & details */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={policy.commandPattern}
              className="
                font-mono text-[13px] font-medium text-[#F1F5F9]
                bg-[#0A0C10] border border-[#1E2433] px-2.5 py-0.5 rounded-md
                break-all sm:break-normal truncate max-w-full sm:max-w-[420px]
              "
            >
              {policy.commandPattern}
            </span>

            {/* Allowance Badge */}
            <span
              className={`
                inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium
                ${
                  isDeny
                    ? "bg-[#EF4444]/15 text-[#F87171] border border-[#EF4444]/30"
                    : isGlobal
                    ? "bg-[#6366F1]/15 text-[#818CF8] border border-[#6366F1]/30"
                    : "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                }
              `}
            >
              {isDeny ? (
                "Deny"
              ) : isGlobal ? (
                <>
                  <GlobeAltIcon className="h-3 w-3" />
                  Global
                </>
              ) : (
                <>
                  <FolderIcon className="h-3 w-3" />
                  Workspace
                </>
              )}
            </span>

            {/* Rule Type Badge */}
            <span className="inline-flex items-center rounded-md border border-[#1F2536] bg-[#141824] px-1.5 py-0.5 text-[10px] text-[#7A889B]">
              {policy.ruleType === "pattern" ? "Wildcard" : "Exact"}
            </span>

            {!policy.enabled && (
              <span className="inline-flex items-center rounded-md border border-[#333] bg-[#1C1C1C] px-1.5 py-0.5 text-[10px] text-[#888]">
                Disabled
              </span>
            )}
          </div>

          {/* Description */}
          {policy.description && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#7A889B] m-0 truncate">
              {policy.description}
            </p>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
        {/* Edit Button */}
        <button
          type="button"
          onClick={() => onEdit(policy)}
          title="Edit Policy"
          aria-label={`Edit policy for ${policy.commandPattern}`}
          data-testid={`edit-policy-${policy.id}`}
          className="
            flex h-8 w-8 items-center justify-center rounded-lg border border-transparent
            text-[#7A889B] transition-colors hover:border-[#262D3E] hover:bg-[#161B26] hover:text-[#E2E8F0]
            focus:outline-none focus:ring-1 focus:ring-[#6366F1]
          "
        >
          <PencilSquareIcon className="h-4 w-4" />
        </button>

        {/* Delete Button */}
        <button
          type="button"
          onClick={() => onDelete(policy)}
          title="Delete Policy"
          aria-label={`Delete policy for ${policy.commandPattern}`}
          data-testid={`delete-policy-${policy.id}`}
          className="
            flex h-8 w-8 items-center justify-center rounded-lg border border-transparent
            text-[#7A889B] transition-colors hover:border-[#EF4444]/30 hover:bg-[#EF4444]/10 hover:text-[#EF4444]
            focus:outline-none focus:ring-1 focus:ring-[#EF4444]
          "
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
