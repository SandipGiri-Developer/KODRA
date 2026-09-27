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
          flex
          w-full
          md:h-full
          md:w-[210px]
          md:min-w-[210px]
          flex-shrink-0
          flex-col
          border-b
          md:border-b-0
          md:border-r
          border-[#1D2230]
          bg-[#0E1118]
        "
      >
        {/* Back to Chat */}
        <button
          type="button"
          onClick={handleBackToChat}
          title="Back to Chat"
          className="
            group
            flex
            h-[46px]
            w-full
            flex-shrink-0
            items-center
            gap-2
            border-0
            border-b
            border-[#1D2230]
            bg-transparent
            px-4
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
          "
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

          <span>Back to Chat</span>
        </button>

        {/* Settings Label */}
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
                className={`
                  relative
                  flex
                  min-h-[38px]
                  w-full
                  items-center
                  gap-2.5
                  rounded-[6px]
                  border-0
                  px-3
                  text-left
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
                AI Providers
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
              Configure AI connections and choose which
              models are available in your workspace.
            </p>
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