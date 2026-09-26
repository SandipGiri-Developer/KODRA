import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon, CubeIcon } from "@heroicons/react/24/outline";
import { ProvidersSettings } from "./ProvidersSettings";
import { ROUTES } from "../../util/navigation";

type SettingCategory = "AI Providers";

const CATEGORIES: SettingCategory[] = ["AI Providers"];

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
    <div className="flex h-full w-full overflow-hidden bg-[#0A0C10] text-[#E2E8F0] font-sans">
      {/* Sidebar */}
      <aside className="flex h-full w-[240px] min-w-[240px] flex-shrink-0 flex-col border-r border-[#1E2333] bg-[#0F121A]">
        {/* Back to Chat */}
        <button
          type="button"
          onClick={handleBackToChat}
          title="Back to Chat"
          className="
            flex min-h-[44px] w-full items-center gap-2
            border-0 border-b border-[#1E2333]
            bg-transparent px-4
            text-left text-[14px] font-normal text-[#CBD5E1]
            transition-colors duration-150
            hover:bg-[#181C28] hover:text-white
            focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6366F1]
          "
        >
          <ArrowLeftIcon className="h-[18px] w-[18px] flex-shrink-0 stroke-[1.8]" />
          <span>Back to Chat</span>
        </button>

        {/* Settings Label */}
        <div className="px-4 pb-[10px] pt-5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">
          Settings
        </div>

        {/* Settings Navigation */}
        <nav
          aria-label="Settings navigation"
          className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-2"
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
                  relative flex min-h-[40px] w-full items-center gap-[10px]
                  rounded-[7px] border-0 px-3
                  text-left text-[14px]
                  transition-colors duration-150
                  focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6366F1]
                  ${
                    isActive
                      ? "bg-[#1A1D2E] font-medium text-[#A5B4FC]"
                      : "bg-transparent font-normal text-[#94A3B8] hover:bg-[#181C28] hover:text-[#F1F5F9]"
                  }
                `}
              >
                {isActive && (
                  <span className="absolute bottom-[7px] left-0 top-[7px] w-[3px] rounded-r-[2px] bg-[#6366F1]" />
                )}

                <CubeIcon className={`h-[17px] w-[17px] flex-shrink-0 stroke-[1.8] ${isActive ? "text-[#818CF8]" : ""}`} />

                <span>{category}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#0A0C10]">
        <div className="mx-auto w-full max-w-[1000px] px-10 pb-16 pt-9">
          {/* Page Header */}
          <header className="mb-8">
            <h1 className="m-0 text-[28px] font-semibold leading-9 tracking-[-0.01em] text-[#F1F5F9]">
              AI Providers
            </h1>

            <p className="mt-[7px] max-w-[720px] text-[14px] font-normal leading-[21px] text-[#94A3B8]">
              Configure connections to AI providers and select which models
              to use in your workspace.
            </p>
          </header>

          {/* Content */}
          <section className="w-full">
            {activeTab === "AI Providers" && <ProvidersSettings />}
          </section>
        </div>
      </main>
    </div>
  );
}