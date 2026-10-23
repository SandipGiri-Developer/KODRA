// Confirmation modal dialog for deleting an existing terminal approval policy.
import React from "react";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ApprovalPolicy } from "./types";

interface DeletePolicyDialogProps {
  policy: ApprovalPolicy | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (policy: ApprovalPolicy) => void;
  isDeleting: boolean;
}

// Renders a confirmation modal before permanently deleting an approval policy.
export function DeletePolicyDialog({
  policy,
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
}: DeletePolicyDialogProps) {
  if (!isOpen || !policy) {
    return null;
  }

  const isGlobal = policy.scope === "global";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-policy-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div
        className="
          relative w-full max-w-[480px] rounded-xl border border-[#262D3E]
          bg-[#0E1118] p-6 shadow-2xl transition-all
        "
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isDeleting}
          aria-label="Close dialog"
          className="
            absolute top-4 right-4 rounded-md p-1 text-[#64748B] transition-colors
            hover:bg-[#1E2333] hover:text-[#E2E8F0] focus:outline-none focus:ring-1 focus:ring-[#6366F1]
          "
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Warning Icon & Title */}
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#EF4444]/15 border border-[#EF4444]/30">
            <ExclamationTriangleIcon className="h-5 w-5 text-[#EF4444]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="delete-policy-title"
              className="text-[16px] font-semibold text-[#F1F5F9] m-0"
            >
              Delete Command Policy
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-[#8D97A8]">
              Are you sure you want to remove this pre-approved policy? Future executions of this command will revert to requiring explicit manual approval.
            </p>
          </div>
        </div>

        {/* Target Policy Details Card */}
        <div className="mt-4 rounded-lg border border-[#1E2333] bg-[#0A0C10] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-[#788396]">Target Command</span>
            <span
              className={`
                inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
                ${
                  isGlobal
                    ? "bg-[#6366F1]/15 text-[#818CF8] border border-[#6366F1]/30"
                    : "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                }
              `}
            >
              {isGlobal ? "Global Policy" : "Workspace Policy"}
            </span>
          </div>
          <div className="mt-2 truncate rounded border border-[#1D2230] bg-[#12151D] px-2.5 py-1.5 font-mono text-[12px] text-[#E2E8F0]">
            {policy.commandPattern}
          </div>
          {policy.description && (
            <p className="mt-2 text-[11px] text-[#64748B] italic m-0 truncate">
              {policy.description}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="
              inline-flex min-h-[36px] items-center justify-center rounded-lg border
              border-[#2A3143] bg-[#151923] px-4 text-[12px] font-medium text-[#C7D0DD]
              transition-colors hover:border-[#3D4760] hover:bg-[#1D2230] hover:text-[#FFFFFF]
              focus:outline-none focus:ring-1 focus:ring-[#6366F1] disabled:opacity-50
            "
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(policy)}
            disabled={isDeleting}
            data-testid="confirm-delete-policy-btn"
            className="
              inline-flex min-h-[36px] items-center justify-center rounded-lg border
              border-[#DC2626] bg-[#DC2626] px-4 text-[12px] font-medium text-white
              shadow-sm transition-all hover:border-[#B91C1C] hover:bg-[#B91C1C]
              focus:outline-none focus:ring-2 focus:ring-[#EF4444]/40 disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            {isDeleting ? "Deleting..." : "Delete Policy"}
          </button>
        </div>
      </div>
    </div>
  );
}
