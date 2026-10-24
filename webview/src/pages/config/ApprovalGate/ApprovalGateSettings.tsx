// Terminal Approval Gate settings panel for configuring global and workspace command policies.
import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheckIcon,
  PlusIcon,
  GlobeAltIcon,
  FolderIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { ApprovalPolicy, PolicyScope } from "./types";
import { CommandPolicyList } from "./CommandPolicyList";
import { CommandPolicyEditor } from "./CommandPolicyEditor";
import { DeletePolicyDialog } from "./DeletePolicyDialog";

// Main settings container component for managing terminal command approval policies.
export function ApprovalGateSettings() {
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);
  const [deletingPolicy, setDeletingPolicy] = useState<ApprovalPolicy | null>(null);

  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Auto-dismiss feedback notice after 4 seconds
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Request policy list and listen for extension IPC responses
  useEffect(() => {
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({ type: "policy/list" });
    }

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "policyList" && Array.isArray(data.policies)) {
        setPolicies(data.policies);
        setIsLoading(false);
      } else if (data.type === "policyUpdated" && data.policy) {
        setPolicies((prev) => {
          const idx = prev.findIndex((p) => p.id === data.policy.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.policy;
            return next;
          }
          return [data.policy, ...prev];
        });
        setIsSaving(false);
        setEditorOpen(false);
        setEditingPolicy(null);
      } else if (data.type === "policyDeleted" && data.id) {
        setPolicies((prev) => prev.filter((p) => p.id !== data.id));
        setIsDeleting(false);
        setDeletingPolicy(null);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Handles adding or updating a policy through extension IPC
  const handleSavePolicy = useCallback(
    async (formData: {
      commandPattern: string;
      scope: PolicyScope;
      description: string;
      ruleType: "exact" | "pattern";
      id?: string;
    }) => {
      setIsSaving(true);

      if ((window as any).vscode) {
        if (formData.id) {
          (window as any).vscode.postMessage({
            type: "policy/update",
            id: formData.id,
            updates: {
              commandPattern: formData.commandPattern,
              scope: formData.scope,
              ruleType: formData.ruleType,
              description: formData.description,
            },
          });
          setNotice({
            type: "success",
            message: `Updated policy for "${formData.commandPattern}".`,
          });
        } else {
          (window as any).vscode.postMessage({
            type: "policy/create",
            policy: {
              commandPattern: formData.commandPattern,
              scope: formData.scope,
              ruleType: formData.ruleType,
              decision: "allow",
              enabled: true,
              description: formData.description,
            },
          });
          setNotice({
            type: "success",
            message: `Created ${formData.scope} policy for "${formData.commandPattern}".`,
          });
        }
      } else {
        // Fallback for test / preview environments
        if (formData.id) {
          setPolicies((prev) =>
            prev.map((p) =>
              p.id === formData.id
                ? {
                  ...p,
                  commandPattern: formData.commandPattern,
                  scope: formData.scope,
                  ruleType: formData.ruleType,
                  description: formData.description,
                  updatedAt: new Date().toISOString(),
                }
                : p
            )
          );
        } else {
          const newPolicy: ApprovalPolicy = {
            id: `pol_${Date.now()}`,
            schemaVersion: 1,
            commandPattern: formData.commandPattern,
            scope: formData.scope,
            ruleType: formData.ruleType,
            decision: "allow",
            enabled: true,
            description: formData.description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setPolicies((prev) => [newPolicy, ...prev]);
        }
        setIsSaving(false);
        setEditorOpen(false);
        setEditingPolicy(null);
      }
    },
    []
  );

  // Handles deleting an existing policy through extension IPC
  const handleConfirmDelete = useCallback(
    (policy: ApprovalPolicy) => {
      setIsDeleting(true);

      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: "policy/delete",
          id: policy.id,
        });
        setNotice({
          type: "success",
          message: `Deleted policy for "${policy.commandPattern}".`,
        });
      } else {
        setPolicies((prev) => prev.filter((p) => p.id !== policy.id));
        setIsDeleting(false);
        setDeletingPolicy(null);
      }
    },
    []
  );

  // Handles toggling a policy enabled or disabled state
  const handleToggleEnable = useCallback(
    (policy: ApprovalPolicy, enabled: boolean) => {
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: "policy/enable",
          id: policy.id,
          enabled,
        });
      }

      setPolicies((prev) =>
        prev.map((p) => (p.id === policy.id ? { ...p, enabled } : p))
      );
    },
    []
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notice */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`
        flex items-start gap-2.5 rounded-lg border px-3.5 py-3
        text-[12.5px] leading-5 transition-all duration-200
        ${notice.type === "success"
              ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300"
              : "border-red-500/25 bg-red-500/[0.07] text-red-300"
            }
      `}
        >
          {notice.type === "success" ? (
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          )}
          <span className="min-w-0 break-words">{notice.message}</span>
        </div>
      )}

      {/* Overview & Security Info Card */}
      <section
        className="
      relative overflow-hidden rounded-2xl
      border border-white/[0.06] bg-white/[0.02]
      p-4 sm:p-6
    "
      >
        {/* Soft glow */}
        <div
          aria-hidden="true"
          className="
        pointer-events-none absolute -left-10 -top-16 h-40 w-64
        rounded-full bg-[#2F48A1]/15 blur-3xl
      "
        />

        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
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
              <h2 className="m-0 text-[15px] font-semibold leading-6 tracking-[-0.01em] text-[#F1F5F9]">
                Command Execution Security Gate
              </h2>
              <p className="m-0 mt-0.5 max-w-[620px] text-[12.5px] leading-5 text-[#8B96A9]">
                Commands in Agent mode require manual confirmation unless matched by
                an allowed policy. Manage pre-approved commands below.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingPolicy(null);
              setEditorOpen(true);
            }}
            data-testid="add-policy-btn"
            className="
          group inline-flex h-9 w-full shrink-0 items-center justify-center
          gap-2 rounded-lg border-0 bg-[#2F48A1] px-4
          text-[12.5px] font-medium text-white
          shadow-md shadow-[#2F48A1]/30
          transition-all duration-200
          hover:-translate-y-px hover:bg-[#3A57C2]
          active:translate-y-0 active:scale-[0.98]
          focus:outline-none
          focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
          sm:w-auto
        "
          >
            <PlusIcon className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
            Add Command Policy
          </button>
        </div>

        {/* Scope Explanation */}
        <div className="relative mt-5 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div
              className="
            flex h-7 w-7 shrink-0 items-center justify-center rounded-lg
            bg-[#2F48A1]/15 text-[#7C93E8]
            ring-1 ring-inset ring-[#2F48A1]/30
          "
            >
              <GlobeAltIcon className="h-4 w-4" />
            </div>
            <p className="m-0 text-[12px] leading-5 text-[#8B96A9]">
              <strong className="font-semibold text-[#E2E8F0]">
                Global Allowance
              </strong>
              <br />
              Pre-approves execution across all workspaces on this system.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div
              className="
            flex h-7 w-7 shrink-0 items-center justify-center rounded-lg
            bg-emerald-500/10 text-emerald-400
            ring-1 ring-inset ring-emerald-500/20
          "
            >
              <FolderIcon className="h-4 w-4" />
            </div>
            <p className="m-0 text-[12px] leading-5 text-[#8B96A9]">
              <strong className="font-semibold text-[#E2E8F0]">
                Workspace Allowance
              </strong>
              <br />
              Pre-approves execution only within the current workspace directory.
            </p>
          </div>
        </div>
      </section>

      {/* Policies List Section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[#F1F5F9]">
            Configured Policies
          </h2>

          <span
            className="
          shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1
          text-[11px] font-medium tabular-nums text-[#8B96A9]
          ring-1 ring-inset ring-white/[0.06]
        "
          >
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </span>
        </div>

        <CommandPolicyList
          policies={policies}
          onEdit={(policy) => {
            setEditingPolicy(policy);
            setEditorOpen(true);
          }}
          onDelete={(policy) => setDeletingPolicy(policy)}
          onToggleEnable={handleToggleEnable}
          onAddNew={() => {
            setEditingPolicy(null);
            setEditorOpen(true);
          }}
        />
      </section>

      {/* Add / Edit Policy Modal Dialog */}
      <CommandPolicyEditor
        isOpen={editorOpen}
        editingPolicy={editingPolicy}
        existingPolicies={policies}
        onClose={() => {
          setEditorOpen(false);
          setEditingPolicy(null);
        }}
        onSave={handleSavePolicy}
        isSaving={isSaving}
      />

      {/* Delete Confirmation Dialog */}
      <DeletePolicyDialog
        isOpen={Boolean(deletingPolicy)}
        policy={deletingPolicy}
        onClose={() => setDeletingPolicy(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
