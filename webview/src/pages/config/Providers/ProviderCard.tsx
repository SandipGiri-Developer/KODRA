import React, { useState, useEffect, useRef } from "react";
import {
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { ProviderIcon } from "./ProviderIcon";
import { ModelChip } from "./ModelChip";
import { PROVIDER_DISPLAY } from "./constants";
import { ProviderCardProps, ProviderType } from "./types";

export function ProviderCard({
  provider,
  models,
  onDelete,
  onEdit,
}: ProviderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const handleOutsideClick = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const visibleModels = models.slice(0, 2);
  const extraCount = Math.max(0, models.length - 2);

  const modelTooltip =
    models.length > 0
      ? models.map((model) => model.displayName).join("\n")
      : "No models selected";

  return (
    <div
      className="
        relative
        flex
        min-h-[52px]
        w-full
        items-center
        gap-3
        border-b
        border-[#1E2333]
        bg-transparent
        px-2
        py-2.5
        transition-all
        duration-150
        hover:bg-[#11141C]
        last:border-b-0
      "
    >
      {/* Provider */}
      <div className="flex min-w-[140px] flex-shrink-0 items-center gap-2">
        <ProviderIcon provider={provider.provider} />
        <span
          title={provider.name}
          className="truncate text-[13px] font-semibold text-[#E7ECF3]"
        >
          {provider.name ||
            PROVIDER_DISPLAY[provider.provider.toLowerCase() as ProviderType]
              ?.label ||
            provider.provider}
        </span>
      </div>

      {/* Connection */}
      <div className="flex min-w-[150px] flex-shrink-0 flex-col">
        <div className="flex items-center gap-2">
          <span
            className="
              h-[6px]
              w-[6px]
              flex-shrink-0
              rounded-full
              bg-[#22C55E]
              shadow-[0_0_6px_rgba(34,197,94,0.35)]
            "
          />

          <span className="text-[12px] font-medium text-[#B9C4D2]">
            Connected
          </span>
        </div>

        {provider.endpoint && (
          <div
            title={provider.endpoint}
            className="
              mt-1
              max-w-[190px]
              truncate
              text-[10px]
              leading-4
              text-[#667085]
            "
          >
            {provider.endpoint}
          </div>
        )}
      </div>

      {/* Models */}
      <div
        title={modelTooltip}
        className="
          flex
          min-w-0
          items-center
          gap-1.5
          overflow-hidden
        "
      >
        {models.length === 0 ? (
          <span className="text-[11px] text-[#5F6979]">
            No models selected
          </span>
        ) : (
          <>
            <span className="sr-only">
              {models.length} {models.length === 1 ? "model" : "models"} selected
            </span>
            {visibleModels.map((model) => (
              <ModelChip
                key={model.id}
                name={model.displayName}
              />
            ))}

            {extraCount > 0 && (
              <ModelChip
                name={`+${extraCount}`}
                muted
              />
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div
        ref={menuRef}
        className="
          relative
          z-20
          flex
          flex-shrink-0
          items-center
        "
      >
        <button
          type="button"
          onClick={() => setMenuOpen((previous) => !previous)}
          aria-label="Provider actions"
          aria-expanded={menuOpen}
          className="
            flex
            h-8
            w-8
            items-center
            justify-center
            rounded-[7px]
            border
            border-transparent
            bg-transparent
            text-[#778196]
            transition-all
            duration-150
            hover:border-[#2D3548]
            hover:bg-[#1A1F2B]
            hover:text-[#D9E0EA]
            focus:outline-none
            focus-visible:border-[#4F46E5]
            focus-visible:ring-2
            focus-visible:ring-[#6366F1]/20
          "
        >
          <EllipsisHorizontalIcon className="h-[18px] w-[18px]" />
        </button>

        {menuOpen && (
          <div
            className="
              absolute
              right-0
              top-[calc(100%+6px)]
              z-[100]
              w-[154px]
              overflow-hidden
              rounded-[8px]
              border
              border-[#2A3142]
              bg-[#151923]
              py-1
              shadow-[0_12px_32px_rgba(0,0,0,.45)]
            "
          >
            <button
              autoFocus
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onEdit(provider);
              }}
              className="
                flex
                w-full
                items-center
                gap-2.5
                px-3
                py-2
                text-left
                text-[12px]
                text-[#CBD5E1]
                transition-colors
                hover:bg-[#1D2330]
                hover:text-[#F1F5F9]
              "
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </button>

            <div className="mx-2 border-t border-[#252B39]" />

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete(provider.id);
              }}
              className="
                flex
                w-full
                items-center
                gap-2.5
                px-3
                py-2
                text-left
                text-[12px]
                text-[#F87171]
                transition-colors
                hover:bg-[#24191F]
                hover:text-[#FCA5A5]
              "
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
