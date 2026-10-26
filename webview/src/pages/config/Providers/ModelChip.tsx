import React from "react";

export function ModelChip({
  name,
  muted = false,
}: {
  name: string;
  muted?: boolean;
}) {
  return (
    <span
      title={name}
      className={`
        inline-flex h-7 max-w-[190px]
        items-center
        overflow-hidden
        text-ellipsis
        whitespace-nowrap
        rounded-[6px]
        border
        px-2.5
        text-[11px]
        leading-4
        transition-colors
        ${
          muted
            ? "border-[#252B3A] bg-[#11151E] text-[#7D8798]"
            : "border-[#292F40] bg-[#151923] text-[#C7D0DD] hover:border-[#394258] hover:bg-[#1A1F2B]"
        }
      `}
    >
      {name}
    </span>
  );
}
