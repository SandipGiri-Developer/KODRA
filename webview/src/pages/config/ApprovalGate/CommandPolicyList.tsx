// Filterable and searchable table listing active terminal command approval policies.
import React, { useState, useMemo } from "react";
import {
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { ApprovalPolicy } from "./types";
import { CommandPolicyRow } from "./CommandPolicyRow";

interface CommandPolicyListProps {
  policies: ApprovalPolicy[];
  onEdit: (policy: ApprovalPolicy) => void;
  onDelete: (policy: ApprovalPolicy) => void;
  onToggleEnable: (policy: ApprovalPolicy, enabled: boolean) => void;
  onAddNew: () => void;
}

// Renders the searchable, filterable list of configured command policies or an informative empty state.
export function CommandPolicyList({
  policies,
  onEdit,
  onDelete,
  onToggleEnable,
  onAddNew,
}: CommandPolicyListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "workspace">("all");

  const globalCount = useMemo(
    () => policies.filter((p) => p.scope === "global").length,
    [policies]
  );
  const workspaceCount = useMemo(
    () => policies.filter((p) => p.scope === "workspace").length,
    [policies]
  );

  // Filters policies according to active search query and allowance scope tab
  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      // Scope filter
      if (scopeFilter !== "all" && policy.scope !== scopeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesCommand = policy.commandPattern.toLowerCase().includes(query);
        const matchesDesc = (policy.description || "").toLowerCase().includes(query);
        return matchesCommand || matchesDesc;
      }
      return true;
    });
  }, [policies, scopeFilter, searchQuery]);

  // Zero policies configured at all: render the onboarding empty state
  if (policies.length === 0) {
    return (
      <div
        data-testid="approval-empty-state"
        className="
          flex flex-col items-center justify-center rounded-2xl border border-dashed
          border-[#22293A] bg-[#0E1118]/60 px-6 py-14 text-center
        "
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2D364D] bg-[#161B27] shadow-lg">
          <ShieldCheckIcon className="h-7 w-7 text-[#818CF8]" />
        </div>

        <h3 className="mt-4 text-[16px] font-semibold text-[#F1F5F9]">
          No Command Policies Configured
        </h3>

        <p className="mt-2 max-w-[420px] text-[12.5px] leading-relaxed text-[#7C899E]">
          All terminal commands require manual approval before running. Add a policy to pre-approve safe, trusted commands globally or within this workspace.
        </p>

        <button
          type="button"
          onClick={onAddNew}
          data-testid="empty-add-policy-btn"
          className="
            mt-6 inline-flex min-h-[38px] items-center gap-2 rounded-lg border
            border-[#6366F1] bg-[#4F46E5] px-4 text-[12px] font-medium text-white
            shadow-md transition-all hover:border-[#4F46E5] hover:bg-[#4338CA]
            focus:outline-none focus:ring-2 focus:ring-[#6366F1]/40
          "
        >
          <PlusIcon className="h-4 w-4" />
          Add Command Policy
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search Bar & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative min-w-0 flex-1 max-w-[360px]">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#64748B]" />
          <input
            type="text"
            data-testid="search-policies-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search policies..."
            className="
              w-full rounded-lg border border-[#1E2333] bg-[#0A0C10] py-2 pr-3 pl-9
              text-[12px] text-[#E5EAF1] placeholder-[#556075] transition-colors
              focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[#6366F1]
            "
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 rounded-lg border border-[#1E2333] bg-[#0A0C10] p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setScopeFilter("all")}
            data-testid="filter-all-btn"
            className={`
              rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors
              ${
                scopeFilter === "all"
                  ? "bg-[#1E2536] text-[#F1F5F9]"
                  : "text-[#7A889B] hover:text-[#C7D0DD]"
              }
            `}
          >
            All ({policies.length})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter("global")}
            data-testid="filter-global-btn"
            className={`
              rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors
              ${
                scopeFilter === "global"
                  ? "bg-[#1E2536] text-[#818CF8]"
                  : "text-[#7A889B] hover:text-[#C7D0DD]"
              }
            `}
          >
            Global ({globalCount})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter("workspace")}
            data-testid="filter-workspace-btn"
            className={`
              rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors
              ${
                scopeFilter === "workspace"
                  ? "bg-[#1E2536] text-[#34D399]"
                  : "text-[#7A889B] hover:text-[#C7D0DD]"
              }
            `}
          >
            Workspace ({workspaceCount})
          </button>
        </div>
      </div>

      {/* Filtered Results */}
      {filteredPolicies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#1E2333] bg-[#0A0C10] px-4 py-10 text-center">
          <p className="text-[12px] text-[#7A889B] m-0">
            No policies match your search or filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setScopeFilter("all");
            }}
            className="mt-2 text-[11px] font-medium text-[#818CF8] hover:underline focus:outline-none"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredPolicies.map((policy) => (
            <CommandPolicyRow
              key={policy.id}
              policy={policy}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleEnable={onToggleEnable}
            />
          ))}
        </div>
      )}
    </div>
  );
}
