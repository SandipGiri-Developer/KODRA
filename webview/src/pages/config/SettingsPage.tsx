// Main settings page layout providing navigation across configuration categories (AI Providers, Approval Gate).
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  Bars3Icon,
  CubeIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { ProvidersSettings } from "./ProvidersSettings";
import { ApprovalGateSettings } from "./ApprovalGate";
import { ROUTES } from "../../util/navigation";

type SettingCategory = "AI Providers" | "Approval Gate";

const CATEGORIES: SettingCategory[] = [
  "AI Providers",
  "Approval Gate",
];

// Renders the main settings view with categorized tabs for AI Providers and Terminal Approval Gate.
export default function SettingsPage() {
  const [activeTab, setActiveTab] =
    useState<SettingCategory>("AI Providers");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const navigate = useNavigate();

  // Posts message to close settings and navigates back to the main chat interface.
  const handleBackToChat = () => {
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "returnToChat",
      });
    }

    navigate(ROUTES.HOME);
  };

  return (
    <div
      className="
        flex
        flex-col
        md:flex-row
        h-full
        w-full
        overflow-hidden
        bg-[#0A0C10]
        text-[#E2E8F0]
      "
    >
      {/* ------------------------------------------------------------------ */}
      {/* Sidebar                                                             */}
      {/* ------------------------------------------------------------------ */}

      <aside
        className={`
          flex
          w-full
          md:h-full
          ${isSidebarCollapsed ? "md:w-[58px] md:min-w-[58px]" : "md:w-[210px] md:min-w-[210px]"}
          flex-shrink-0
          flex-col
          border-b
          md:border-b-0
          md:border-r
          border-[#1D2230]
          bg-[#0E1118]
          transition-all
          duration-200
          ease-in-out
        `}
      >
        {/* Top Header Row with Back to Chat and Collapse/Expand Hamburger */}
        <div className="flex h-[46px] w-full flex-shrink-0 items-center justify-between border-b border-[#1D2230]">
          {/* Back to Chat */}
          <button
            type="button"
            onClick={handleBackToChat}
            title="Back to Chat"
            aria-label="Back to Chat"
            className={`
              group
              flex
              h-full
              items-center
              gap-2
              border-0
              bg-transparent
              text-left
              text-[12px]
              font-medium
              text-[#8D97A8]
              transition-colors
              duration-150
              hover:bg-[#151923]
              hover:text-[#E7ECF3]
              focus:outline-none
              focus-visible:ring-1
              focus-visible:ring-[#6366F1]
              ${isSidebarCollapsed ? "w-[28px] justify-center px-1" : "flex-1 px-4"}
            `}
          >
            <ArrowLeftIcon
              className="
                h-[16px]
                w-[16px]
                flex-shrink-0
                stroke-[1.8]
                transition-transform
                duration-150
                group-hover:-translate-x-[1px]
              "
            />
            {!isSidebarCollapsed && <span>Back to Chat</span>}
          </button>

          {/* Hamburger Collapse/Expand Toggle */}
          <button
            type="button"
            id="toggle-sidebar-btn"
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="
              flex
              h-full
              w-[38px]
              flex-shrink-0
              items-center
              justify-center
              border-0
              border-l
              border-[#1D2230]
              bg-transparent
              text-[#8D97A8]
              transition-colors
              duration-150
              hover:bg-[#151923]
              hover:text-[#E7ECF3]
              focus:outline-none
              focus-visible:ring-1
              focus-visible:ring-[#6366F1]
            "
          >
            <Bars3Icon className="h-[17px] w-[17px] stroke-[1.8]" />
          </button>
        </div>

        {/* Settings Label */}
        {!isSidebarCollapsed ? (
          <div
            className="
              px-4
              pb-2
              pt-5
              text-[10px]
              font-semibold
              uppercase
              tracking-[0.09em]
              text-[#596476]
            "
          >
            Settings
          </div>
        ) : (
          <div className="my-2 border-b border-[#1D2230] mx-2" />
        )}

        {/* Navigation */}
        <nav
          aria-label="Settings navigation"
          className="
            flex
            flex-row
            md:flex-col
            flex-1
            gap-1
            overflow-x-auto
            md:overflow-y-auto
            px-2
            pb-2
            md:pb-0
          "
        >
          {CATEGORIES.map((category) => {
            const isActive =
              activeTab === category;

            return (
              <button
                key={category}
                type="button"
                onClick={() =>
                  setActiveTab(category)
                }
                aria-current={
                  isActive ? "page" : undefined
                }
                title={category}
                aria-label={category}
                className={`
                  relative
                  flex
                  min-h-[38px]
                  w-full
                  items-center
                  ${isSidebarCollapsed ? "justify-center px-0" : "gap-2.5 px-3 text-left"}
                  rounded-[6px]
                  border-0
                  text-[12px]
                  transition-colors
                  duration-150
                  focus:outline-none
                  focus-visible:ring-1
                  focus-visible:ring-[#6366F1]

                  ${
                    isActive
                      ? "bg-[#171B28] font-medium text-[#C7D2FE]"
                      : "bg-transparent font-normal text-[#7D8798] hover:bg-[#151923] hover:text-[#D8DEE8]"
                  }
                `}
              >
                {/* Active indicator */}
                {isActive && (
                  <span
                    className="
                      absolute
                      bottom-[8px]
                      left-0
                      top-[8px]
                      w-[2px]
                      rounded-r-full
                      bg-[#6366F1]
                    "
                  />
                )}

                {category === "AI Providers" ? (
                  <CubeIcon
                    className={`
                      h-[16px]
                      w-[16px]
                      flex-shrink-0
                      stroke-[1.7]
                      ${
                        isActive
                          ? "text-[#818CF8]"
                          : "text-[#687386]"
                      }
                    `}
                  />
                ) : (
                  <ShieldCheckIcon
                    className={`
                      h-[16px]
                      w-[16px]
                      flex-shrink-0
                      stroke-[1.7]
                      ${
                        isActive
                          ? "text-[#818CF8]"
                          : "text-[#687386]"
                      }
                    `}
                  />
                )}

                {!isSidebarCollapsed ? (
                  <span>{category}</span>
                ) : (
                  <span className="sr-only">{category}</span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Main Content                                                        */}
      {/* ------------------------------------------------------------------ */}

      <main
        className="
          min-w-0
          flex-1
          overflow-x-hidden
          overflow-y-auto
          bg-[#0A0C10]
        "
      >
        <div
          className={`
            mx-auto
            w-full
            ${isSidebarCollapsed ? "max-w-[1060px]" : "max-w-[940px]"}
            px-8
            pb-16
            pt-8
            transition-all
            duration-200
          `}
        >
          {/* Page Header */}
          <header className="mb-7">
            <div className="flex items-center gap-2">
              <h1
                className="
                  m-0
                  text-[24px]
                  font-semibold
                  leading-8
                  tracking-[-0.015em]
                  text-[#F1F5F9]
                "
              >
                {activeTab}
              </h1>
            </div>

            <p
              className="
                mt-1.5
                max-w-[680px]
                text-[12px]
                font-normal
                leading-[19px]
                text-[#788396]
              "
            >
              {activeTab === "AI Providers"
                ? "Configure AI connections and choose which models are available in your workspace."
                : "Manage terminal command approval policies for Global and Workspace execution."}
            </p>
          </header>

          {/* Content */}
          <section className="w-full">
            {/* ProvidersSettings: Manages LLM endpoints, credentials, and workspace models */}
            {activeTab === "AI Providers" && (
              <ProvidersSettings />
            )}
            {/* ApprovalGateSettings: Configures terminal command execution safety policies */}
            {activeTab === "Approval Gate" && (
              <ApprovalGateSettings />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}