// Individual policy row component displaying policy scope, rule pattern, and action buttons.
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
    group relative flex flex-col justify-between gap-3
    rounded-xl border p-3.5 transition-all duration-200 sm:flex-row sm:items-center sm:gap-4 sm:p-4
    ${policy.enabled
          ? "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
          : "border-white/[0.04] bg-white/[0.01] hover:border-white/[0.08]"
        }
  `}
    >
      {/* Left: Toggle + Command info */}
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        {/* Enable / Disable Switch (still a real checkbox underneath) */}
        <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
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
        </label>

        {/* Command pattern & details (dimmed when disabled) */}
        <div
          className={`min-w-0 flex-1 transition-opacity duration-200 ${policy.enabled ? "opacity-100" : "opacity-55 group-hover:opacity-80"
            }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={policy.commandPattern}
              className="
            block max-w-full truncate rounded-md
            border border-white/[0.08] bg-[#0A0D13] px-2.5 py-1
            font-mono text-[12.5px] font-medium text-[#F1F5F9]
            sm:max-w-[420px]
          "
            >
              {policy.commandPattern}
            </span>

            {/* Allowance Badge */}
            <span
              className={`
            inline-flex items-center gap-1 rounded-full px-2 py-0.5
            text-[11px] font-medium ring-1 ring-inset
            ${isDeny
                  ? "bg-red-500/10 text-red-300 ring-red-500/25"
                  : isGlobal
                    ? "bg-[#2F48A1]/20 text-[#9DB0F0] ring-[#2F48A1]/35"
                    : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
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
            <span
              className="
            inline-flex items-center rounded-md bg-white/[0.04]
            px-1.5 py-0.5 text-[10.5px] font-medium
            text-[#8B96A9] ring-1 ring-inset ring-white/[0.06]
          "
            >
              {policy.ruleType === "pattern" ? "Wildcard" : "Exact"}
            </span>

            {!policy.enabled && (
              <span
                className="
              inline-flex items-center rounded-md bg-white/[0.06]
              px-1.5 py-0.5 text-[10.5px] font-medium uppercase
              tracking-[0.04em] text-[#9AA4B5]
              ring-1 ring-inset ring-white/[0.08]
            "
              >
                Disabled
              </span>
            )}
          </div>

          {/* Description */}
          {policy.description && (
            <p
              title={policy.description}
              className="m-0 mt-1.5 truncate text-[12px] leading-5 text-[#8B96A9]"
            >
              {policy.description}
            </p>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
        {/* Edit Button */}
        <button
          type="button"
          onClick={() => onEdit(policy)}
          title="Edit Policy"
          aria-label={`Edit policy for ${policy.commandPattern}`}
          data-testid={`edit-policy-${policy.id}`}
          className="
        flex h-9 w-9 items-center justify-center rounded-lg border-0
        bg-transparent text-[#8B96A9] transition-colors duration-150
        hover:bg-white/[0.06] hover:text-[#F1F5F9]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
        sm:h-8 sm:w-8
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
        flex h-9 w-9 items-center justify-center rounded-lg border-0
        bg-transparent text-[#8B96A9] transition-colors duration-150
        hover:bg-red-500/10 hover:text-red-300
        focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50
        sm:h-8 sm:w-8
      "
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
