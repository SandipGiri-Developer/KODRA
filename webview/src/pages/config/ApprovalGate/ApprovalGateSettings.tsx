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
          className={`
            flex items-center gap-2 rounded-lg border p-3 text-[12px] leading-5 transition-all
            ${
              notice.type === "success"
                ? "border-[#10B981]/30 bg-[#10B981]/10 text-[#6EE7B7]"
                : "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#FCA5A5]"
            }
          `}
        >
          {notice.type === "success" ? (
            <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-[#10B981]" />
          ) : (
            <XCircleIcon className="h-4 w-4 flex-shrink-0 text-[#EF4444]" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Overview & Security Info Card */}
      <section className="rounded-xl border border-[#1E2333] bg-[#0E1118] p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#2B354C] bg-[#161B27] shadow-sm">
              <ShieldCheckIcon className="h-5 w-5 text-[#818CF8]" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#F1F5F9] m-0">
                Command Execution Security Gate
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[#7C899E] m-0 max-w-[620px]">
                Commands in Agent mode require manual confirmation unless matched by an allowed policy. Manage pre-approved commands below.
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
              inline-flex min-h-[38px] items-center gap-2 rounded-lg border
              border-[#6366F1] bg-[#4F46E5] px-4 text-[12px] font-medium text-white
              shadow-sm transition-all hover:border-[#4F46E5] hover:bg-[#4338CA]
              focus:outline-none focus:ring-2 focus:ring-[#6366F1]/40 flex-shrink-0
            "
          >
            <PlusIcon className="h-4 w-4" />
            Add Command Policy
          </button>
        </div>

        {/* Scope Explanation Pills */}
        <div className="mt-4 pt-4 border-t border-[#181D2A] grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11.5px]">
          <div className="flex items-center gap-2 text-[#8D99AE]">
            <GlobeAltIcon className="h-4 w-4 flex-shrink-0 text-[#818CF8]" />
            <span>
              <strong className="text-[#C5D0E0]">Global Allowance:</strong> Pre-approves execution across all workspaces on this system.
            </span>
          </div>
          <div className="flex items-center gap-2 text-[#8D99AE]">
            <FolderIcon className="h-4 w-4 flex-shrink-0 text-[#34D399]" />
            <span>
              <strong className="text-[#C5D0E0]">Workspace Allowance:</strong> Pre-approves execution only within the current workspace directory.
            </span>
          </div>
        </div>
      </section>

      {/* Policies List Section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#E2E8F0] m-0">
            Configured Policies ({policies.length})
          </h2>
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
