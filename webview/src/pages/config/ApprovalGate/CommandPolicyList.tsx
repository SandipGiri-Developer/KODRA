// Filterable and searchable table listing active terminal command approval policies.
import React, { useState, useMemo } from "react";
import {
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  PlusIcon,
  XMarkIcon,
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

  const searchInputClass = `
  h-10 w-full rounded-lg border border-white/[0.08] bg-[#0A0D13]
  pl-9 pr-9 text-[13px] text-[#F1F5F9] outline-none
  placeholder:text-[#5E6A7E] transition-colors duration-150
  hover:border-white/[0.16]
  focus:border-[#2F48A1] focus:ring-2 focus:ring-[#2F48A1]/30
`;

  const filterBase = `
  inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap
  rounded-md border-0 px-3 text-[12px] font-medium
  transition-all duration-150
  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
  sm:flex-none
`;

  return (
    <div className="flex flex-col gap-4">
      {/* Search Bar & Filter Tabs */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        {/* Search Input */}
        <div className="relative min-w-0 flex-1 sm:max-w-[360px]">
          <MagnifyingGlassIcon
            className="
          pointer-events-none absolute left-3 top-1/2
          h-4 w-4 -translate-y-1/2 text-[#5E6A7E]
        "
          />
          <input
            type="text"
            data-testid="search-policies-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search policies..."
            aria-label="Search policies"
            className={searchInputClass}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="
            absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2
            items-center justify-center rounded-md border-0
            bg-transparent text-[#6B778C] transition-colors duration-150
            hover:bg-white/[0.06] hover:text-[#F1F5F9]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          "
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Segmented Control */}
        <div
          role="group"
          aria-label="Filter policies by scope"
          className="
        flex w-full items-center gap-1 rounded-lg
        border border-white/[0.08] bg-[#0A0D13] p-1
        sm:w-auto
      "
        >
          <button
            type="button"
            onClick={() => setScopeFilter("all")}
            data-testid="filter-all-btn"
            aria-pressed={scopeFilter === "all"}
            className={`
          ${filterBase}
          ${scopeFilter === "all"
                ? "bg-white/[0.09] text-[#F1F5F9] shadow-sm"
                : "bg-transparent text-[#8B96A9] hover:bg-white/[0.04] hover:text-[#E2E8F0]"
              }
        `}
          >
            All
            <span className="tabular-nums text-[11px] opacity-70">
              {policies.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setScopeFilter("global")}
            data-testid="filter-global-btn"
            aria-pressed={scopeFilter === "global"}
            className={`
          ${filterBase}
          ${scopeFilter === "global"
                ? "bg-[#2F48A1]/25 text-[#B4C2F5] shadow-[inset_0_0_0_1px_rgba(47,72,161,0.45)]"
                : "bg-transparent text-[#8B96A9] hover:bg-white/[0.04] hover:text-[#E2E8F0]"
              }
        `}
          >
            Global
            <span className="tabular-nums text-[11px] opacity-70">
              {globalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setScopeFilter("workspace")}
            data-testid="filter-workspace-btn"
            aria-pressed={scopeFilter === "workspace"}
            className={`
          ${filterBase}
          ${scopeFilter === "workspace"
                ? "bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]"
                : "bg-transparent text-[#8B96A9] hover:bg-white/[0.04] hover:text-[#E2E8F0]"
              }
        `}
          >
            Workspace
            <span className="tabular-nums text-[11px] opacity-70">
              {workspaceCount}
            </span>
          </button>
        </div>
      </div>

      {/* Filtered Results */}
      {filteredPolicies.length === 0 ? (
        <div
          className="
        flex flex-col items-center justify-center rounded-xl
        border border-dashed border-white/[0.1]
        bg-gradient-to-b from-white/[0.03] to-transparent
        px-6 py-10 text-center
      "
        >
          <div
            className="
          mb-3 flex h-10 w-10 items-center justify-center rounded-xl
          bg-[#2F48A1]/15 text-[#7C93E8]
          ring-1 ring-inset ring-[#2F48A1]/30
          shadow-[0_0_20px_-6px_rgba(47,72,161,0.6)]
        "
          >
            <MagnifyingGlassIcon className="h-5 w-5" />
          </div>

          <p className="m-0 text-[14px] font-semibold leading-5 text-[#F1F5F9]">
            No policies found
          </p>
          <p className="m-0 mt-1 max-w-[320px] text-[12.5px] leading-5 text-[#8B96A9]">
            Nothing matches your search or filter. Try different keywords or reset
            the filters.
          </p>

          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setScopeFilter("all");
            }}
            className="
          mt-4 inline-flex h-8 items-center justify-center rounded-lg
          border border-white/[0.1] bg-transparent px-3.5
          text-[12px] font-medium text-[#B8C2D4]
          transition-colors duration-150
          hover:bg-white/[0.06] hover:text-[#F1F5F9]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
        "
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
