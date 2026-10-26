import React from "react";
import {
  Anthropic,
  Gemini,
  Ollama,
  OpenAI,
  Groq,
  DeepSeek,
  Nvidia,
} from "@lobehub/icons";
import { PROVIDER_DISPLAY } from "./constants";
import { ProviderType } from "./types";

export function ProviderIcon({
  provider,
  size = 15,
  className = "",
}: {
  provider: string;
  size?: number | string;
  className?: string;
}) {
  const styles: Record<string, string> = {
    ollama: "bg-[#161A26] border-[#262D3E]",
    openai: "bg-[#10241E] border-[#18483B]",
    anthropic: "bg-[#241C18] border-[#3B2C24]",
    gemini: "bg-[#141F33] border-[#223554]",
    groq: "bg-[#1A1A1A] border-[#333333]",
    deepseek: "bg-[#0B1C36] border-[#1D3B6A]",
    nvidia: "bg-[#11240A] border-[#224814]",
  };

  const renderIcon = () => {
    const key = (provider || "").toLowerCase();

    if (key.includes("ollama")) {
      return (
        <Ollama
          size={size}
          className="text-[#E2E8F0]"
        />
      );
    }

    if (key.includes("openai")) {
      return (
        <OpenAI
          size={size}
          className="text-[#10A37F]"
        />
      );
    }

    if (key.includes("anthropic") || key.includes("claude")) {
      return (
        <Anthropic
          size={size}
          className="text-[#D4A373]"
        />
      );
    }

    if (key.includes("gemini") || key.includes("google")) {
      return <Gemini.Color size={size} />;
    }

    if (key.includes("groq")) {
      return (
        <Groq
          size={size}
          className="text-[#F55036]"
        />
      );
    }

    if (key.includes("deepseek")) {
      return <DeepSeek.Color size={size} />;
    }

    if (key.includes("nvidia")) {
      return <Nvidia.Color size={size} />;
    }

    return (
      <span className="text-[14px] font-semibold text-[#E2E8F0]">
        {provider.charAt(0).toUpperCase()}
      </span>
    );
  };

  return (
    <div
      title={
        PROVIDER_DISPLAY[
          provider.toLowerCase() as ProviderType
        ]?.label ?? provider
      }
      aria-label={
        PROVIDER_DISPLAY[
          provider.toLowerCase() as ProviderType
        ]?.label ?? provider
      }
      className={`
        flex h-8 w-8 flex-shrink-0 items-center justify-center
        rounded-full
        border
        ${styles[provider.toLowerCase()] ??
        "bg-[#161A26] border-[#262D3E]"}
        ${className}
      `}
    >
      {renderIcon()}
    </div>
  );
}
