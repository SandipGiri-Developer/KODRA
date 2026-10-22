import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  CubeIcon,
} from "@heroicons/react/24/outline";
import { ProvidersSettings } from "./ProvidersSettings";
import { ROUTES } from "../../util/navigation";

type SettingCategory = "AI Providers";

const CATEGORIES: SettingCategory[] = [
  "AI Providers",
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] =
    useState<SettingCategory>("AI Providers");

  const navigate = useNavigate();

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
        className="
    flex w-full flex-shrink-0 flex-col
    border-b border-white/[0.06] bg-[#0D1017]
    md:h-full md:w-[220px] md:min-w-[220px] md:border-b-0 md:border-r
  "
      >
        {/* Back to Chat */}
        <div className="flex-shrink-0 border-b border-white/[0.06] p-2">
          <button
            type="button"
            onClick={handleBackToChat}
            title="Back to Chat"
            className="
        group flex h-9 w-full items-center gap-2 rounded-lg border-0
        bg-transparent px-2.5 text-left text-[12.5px] font-medium
        text-[#8B96A9] transition-colors duration-150
        hover:bg-white/[0.05] hover:text-[#F1F5F9]
        focus:outline-none
        focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
      "
          >
            <span
              className="
          flex h-6 w-6 items-center justify-center rounded-md
          bg-white/[0.04] text-[#8B96A9] transition-colors duration-150
          group-hover:bg-[#2F48A1]/20 group-hover:text-[#9DB0F0]
        "
            >
              <ArrowLeftIcon
                className="
            h-3.5 w-3.5 flex-shrink-0 stroke-[2]
            transition-transform duration-150
            group-hover:-translate-x-px
          "
              />
            </span>
            <span>Back to Chat</span>
          </button>
        </div>

        {/* Settings Label */}
        <div
          className="
      px-5 pb-2 pt-5 text-[10.5px] font-semibold uppercase
      tracking-[0.1em] text-[#5E6A7E]
    "
        >
          Settings
        </div>

        {/* Navigation */}
        <nav
          aria-label="Settings navigation"
          className="
      flex flex-1 flex-row gap-1 overflow-x-auto px-3 pb-3
      md:flex-col md:overflow-y-auto md:overflow-x-hidden md:pb-4
    "
        >
          {CATEGORIES.map((category) => {
            const isActive = activeTab === category;

            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveTab(category)}
                aria-current={isActive ? "page" : undefined}
                className={`
            group relative flex h-9 shrink-0 items-center gap-2.5
            whitespace-nowrap rounded-lg border-0 px-3 text-left
            text-[12.5px] transition-all duration-150
            focus:outline-none
            focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            md:w-full
            ${isActive
                    ? "bg-[#2F48A1]/[0.18] font-medium text-[#DCE4FF] shadow-[inset_0_0_0_1px_rgba(47,72,161,0.35)]"
                    : "bg-transparent font-normal text-[#8B96A9] hover:bg-white/[0.05] hover:text-[#E2E8F0]"
                  }
          `}
              >
                {/* Active indicator */}
                {isActive && (
                  <span
                    className="
                absolute bottom-2 left-0 top-2 hidden w-[3px]
                rounded-r-full bg-[#5B76D9]
                shadow-[0_0_10px_rgba(91,118,217,0.6)] md:block
              "
                  />
                )}

                <CubeIcon
                  className={`
              h-4 w-4 flex-shrink-0 stroke-[1.8] transition-colors duration-150
              ${isActive
                      ? "text-[#8FA5F0]"
                      : "text-[#667286] group-hover:text-[#A3AFC2]"
                    }
            `}
                />

                <span>{category}</span>
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
          className="
            mx-auto
            w-full
            max-w-[940px]
            px-8
            pb-16
            pt-8
          "
        >
          {/* Page Header */}
          <header className="mb-8">
            <div className="flex items-start gap-3.5">
              {/* Icon tile */}
              <div
                className="
        flex h-10 w-10 shrink-0 items-center justify-center
        rounded-xl
        bg-[#2F48A1]/15
        ring-1 ring-inset ring-[#2F48A1]/30
        text-[#7C93E8]
        shadow-[0_0_20px_-6px_rgba(47,72,161,0.6)]
      "
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3z" />
                  <path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9z" />
                </svg>
              </div>

              {/* Text */}
              <div className="min-w-0">
                <h1 className="m-0 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[#F1F5F9]">
                  AI Providers
                </h1>
                <p className="mt-1 max-w-[640px] text-[13px] font-normal leading-5 text-[#8B96A9]">
                  Configure AI connections and choose which models are available in your
                  workspace.
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="mt-6 h-px w-full bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
          </header>

          {/* Content */}
          <section className="w-full">
            {activeTab === "AI Providers" && (
              <ProvidersSettings />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}