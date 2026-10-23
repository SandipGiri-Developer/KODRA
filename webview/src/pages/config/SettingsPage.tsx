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
        box-border [&_*]:box-border
        flex w-full flex-shrink-0 flex-col
        border-b border-white/[0.06]
        bg-gradient-to-b from-[#0F131B] to-[#0B0E14]
        md:h-full md:w-[232px] md:min-w-[232px] md:border-b-0 md:border-r
      "
      >
        {/* Back to Chat */}
        <div className="flex-shrink-0 border-b border-white/[0.06] p-2.5">
          <button
            type="button"
            onClick={handleBackToChat}
            title="Back to Chat"
            className="
            group flex h-9 w-full items-center gap-2.5 rounded-lg
            appearance-none border-0 !bg-transparent px-2 text-left
            text-[12.5px] font-medium text-[#8B96A9]
            transition-colors duration-150 cursor-pointer
            hover:!bg-white/[0.05] hover:text-[#F1F5F9]
            focus:outline-none
            focus-visible:ring-2 focus-visible:ring-[#4A63C9]/60
          "
          >
            <span
              className="
              flex h-6 w-6 items-center justify-center rounded-md
              bg-white/[0.04] text-[#8B96A9]
              ring-1 ring-inset ring-white/[0.06]
              transition-colors duration-150
              group-hover:bg-[#2F48A1]/20 group-hover:text-[#9DB0F0]
              group-hover:ring-[#2F48A1]/30
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
          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
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
                whitespace-nowrap rounded-lg px-3 text-left
                appearance-none border-0 cursor-pointer
                text-[12.5px] transition-all duration-150
                focus:outline-none
                focus-visible:ring-2 focus-visible:ring-[#4A63C9]/60
                md:w-full
                ${isActive
                    ? "!bg-[#18214F] hover:!bg-[#1B2659] font-medium text-[#E6ECFF] shadow-[inset_0_0_0_1px_rgba(74,99,201,0.45)]"
                    : "!bg-transparent font-normal text-[#8B96A9] hover:!bg-white/[0.05] hover:text-[#E2E8F0]"
                  }
              `}
              >
                {/* Active indicator */}
                {isActive && (
                  <span
                    className="
                    absolute bottom-2 left-0 top-2 hidden w-[3px]
                    rounded-r-full bg-[#6F8AF0]
                    shadow-[0_0_10px_rgba(111,138,240,0.7)] md:block
                  "
                  />
                )}

                <CubeIcon
                  className={`
                  h-4 w-4 flex-shrink-0 stroke-[1.8] transition-colors duration-150
                  ${isActive
                      ? "text-[#9DB0F5]"
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
            <h1 className="m-0 text-[22px] font-semibold leading-7 tracking-tight text-[#E5E7EB]">
              AI Providers
            </h1>

            <p className="mt-1 text-sm leading-5 text-[#858585]">
              Configure AI connections and choose which models are available in your
              workspace.
            </p>

            <div className="mt-6 border-b border-white/[0.07]" />
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