import React from "react";
import {
  WrenchScrewdriverIcon,
  PhotoIcon,
  LightBulbIcon,
} from "@heroicons/react/24/outline";
import { DiscoveredModel } from "./types";

export function CapabilityChips({
  capabilities,
}: {
  capabilities: DiscoveredModel["capabilities"];
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {capabilities.toolCalling && (
        <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-1.5 text-[10px] text-[#AEB8C7]">
          <WrenchScrewdriverIcon className="h-3 w-3 text-[#818CF8]" />
          Tools
        </span>
      )}

      {capabilities.vision && (
        <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-1.5 text-[10px] text-[#AEB8C7]">
          <PhotoIcon className="h-3 w-3 text-[#818CF8]" />
          Vision
        </span>
      )}

      {capabilities.reasoning && (
        <span className="inline-flex h-5 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-1.5 text-[10px] text-[#AEB8C7]">
          <LightBulbIcon className="h-3 w-3 text-[#818CF8]" />
          Reasoning
        </span>
      )}
    </div>
  );
}
