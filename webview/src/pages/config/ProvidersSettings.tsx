// AI Provider settings panel for managing credentials, endpoints, and discovering models across providers.
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
  WrenchScrewdriverIcon,
  PhotoIcon,
  LightBulbIcon,
  EllipsisHorizontalIcon,
  ChevronDownIcon,
  ServerIcon,
  KeyIcon,
  PencilIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowLeftIcon,
  CubeIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  Anthropic,
  Gemini,
  Ollama,
  OpenAI,
  Groq,
  DeepSeek,
  Nvidia,
} from "@lobehub/icons";
import {
  DiscoveredModel,
  ProviderSettings,
  WorkspaceModel,
} from "../../../../src/providers/types";

type ProviderType = "ollama" | "openai" | "anthropic" | "gemini" | "groq" | "deepseek" | "nvidia";

const PROVIDER_DISPLAY: Record<
  ProviderType,
  { label: string }
> = {
  ollama: { label: "Ollama" },
  openai: { label: "OpenAI" },
  anthropic: { label: "Anthropic" },
  gemini: { label: "Google Gemini" },
  groq: { label: "Groq" },
  deepseek: { label: "DeepSeek" },
  nvidia: { label: "NVIDIA NIM" },
};

const PROVIDER_OPTIONS: {
  value: ProviderType;
  label: string;
}[] = [
    { value: "ollama", label: "Ollama" },
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "gemini", label: "Google Gemini" },
    { value: "groq", label: "Groq" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "nvidia", label: "NVIDIA NIM" },
  ];

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  nvidia: "https://integrate.api.nvidia.com/v1",
};


// Renders a branded icon badge corresponding to a specific AI model provider.
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

// Renders pill badges representing model capabilities (tools, vision, reasoning).
function CapabilityChips({
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

/* -------------------------------------------------------------------------- */
/* Model Chip                                                                  */
/* -------------------------------------------------------------------------- */

// Renders an individual model badge with remove action in provider cards.
function ModelChip({
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
        ${muted
          ? "border-[#252B3A] bg-[#11151E] text-[#7D8798]"
          : "border-[#292F40] bg-[#151923] text-[#C7D0DD] hover:border-[#394258] hover:bg-[#1A1F2B]"
        }
      `}
    >
      {name}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Provider Card                                                               */
/* -------------------------------------------------------------------------- */

interface ProviderCardProps {
  provider: ProviderSettings;
  models: WorkspaceModel[];
  onDelete: (id: string) => void;
  onEdit: (provider: ProviderSettings) => void;
}

// Card component displaying configured provider details, connection status, and models.
function ProviderCard({
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
      className={`
      group/card relative box-border grid w-full min-w-0 max-w-full items-center
      grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3
      rounded-xl border border-white/[0.06] bg-white/[0.02]
      p-3 transition-all duration-200
      hover:border-white/[0.12] hover:bg-white/[0.04]
      sm:px-4 sm:py-3.5
      md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] md:gap-x-3 md:py-3
      [&_*]:box-border
      ${menuOpen ? "z-30" : "z-0"}
    `}
    >
      {/* Provider */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 md:col-start-auto md:row-start-auto">
        <div
          className="
          flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]
        "
        >
          <ProviderIcon provider={provider.provider} />
        </div>

        <span
          title={provider.name}
          className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-[#F1F5F9]"
        >
          {provider.name ||
            PROVIDER_DISPLAY[provider.provider.toLowerCase() as ProviderType]
              ?.label ||
            provider.provider}
        </span>
      </div>

      {/* Models */}
      <div
        title={modelTooltip}
        className="
        col-span-2 flex min-w-0 flex-wrap items-center gap-1.5
        md:col-span-1 md:flex-nowrap md:overflow-hidden
      "
      >
        {models.length === 0 ? (
          <span className="text-[11.5px] italic text-[#667286]">
            No models selected
          </span>
        ) : (
          <>
            <span className="sr-only">
              {models.length} {models.length === 1 ? "model" : "models"} selected
            </span>
            {visibleModels.map((model) => (
              <ModelChip key={model.id} name={model.displayName} />
            ))}

            {extraCount > 0 && <ModelChip name={`+${extraCount}`} muted />}
          </>
        )}
      </div>

      {/* Actions */}
      <div
        ref={menuRef}
        className="
        relative z-20 col-start-2 row-start-1 flex shrink-0 items-center justify-self-end
        md:col-start-auto md:row-start-auto
      "
      >
        <button
          type="button"
          onClick={() => setMenuOpen((previous) => !previous)}
          aria-label="Provider actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`
          flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0
          transition-all duration-150
          focus:outline-none
          focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          md:h-8 md:w-8
          ${menuOpen
              ? "bg-[#2F48A1]/20 text-[#9DB0F0]"
              : "bg-transparent text-[#8B96A9] hover:bg-white/[0.06] hover:text-[#F1F5F9]"
            }
        `}
        >
          <EllipsisHorizontalIcon className="h-[18px] w-[18px]" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="
            absolute right-0 top-[calc(100%+6px)] z-[100] w-44
            overflow-hidden rounded-xl
            border border-white/[0.1] bg-[#141823]
            p-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]
          "
          >
            <button
              autoFocus
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit(provider);
              }}
              className="
              flex min-h-[40px] w-full items-center gap-2.5 rounded-lg border-0
              bg-transparent px-2.5 text-left text-[12.5px]
              text-[#CBD5E1] transition-colors duration-150
              hover:bg-white/[0.06] hover:text-[#F1F5F9]
              focus:outline-none focus-visible:bg-white/[0.06]
              md:min-h-[34px]
            "
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </button>

            <div className="mx-1 my-1 h-px bg-white/[0.06]" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete(provider.id);
              }}
              className="
              flex min-h-[40px] w-full items-center gap-2.5 rounded-lg border-0
              bg-transparent px-2.5 text-left text-[12.5px]
              text-[#F87171] transition-colors duration-150
              hover:bg-red-500/10 hover:text-[#FCA5A5]
              focus:outline-none focus-visible:bg-red-500/10
              md:min-h-[34px]
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

type DiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

interface AddProviderFormProps {
  onCancel: () => void;
  onSaved: () => void;
  existingModels: WorkspaceModel[];
  editingProvider?: ProviderSettings | null;
}

// Modal form for connecting a new AI provider, validating endpoints, and selecting models.
function AddProviderForm({
  onCancel,
  onSaved,
  existingModels,
  editingProvider = null,
}: AddProviderFormProps) {
  const isEditing = Boolean(editingProvider);

  const [providerType, setProviderType] =
    useState<ProviderType>(
      (editingProvider?.provider as ProviderType) ??
      "ollama",
    );

  const [name, setName] = useState(
    editingProvider?.name ?? "",
  );

  const [endpoint, setEndpoint] = useState(
    editingProvider?.endpoint ?? "",
  );

  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const [isConnecting, setIsConnecting] =
    useState(false);

  const [connectionError, setConnectionError] =
    useState<string | null>(null);

  const [discoveredModels, setDiscoveredModels] =
    useState<DiscoveredModel[]>([]);

  const [selectedIds, setSelectedIds] =
    useState<string[]>([]);

  const [status, setStatus] =
    useState<DiscoveryStatus>("idle");

  const [modelSearchQuery, setModelSearchQuery] = useState("");

  // Fetch stored API key when editing an existing provider
  useEffect(() => {
    if (editingProvider) {
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: "getProviderApiKey",
          id: editingProvider.id,
        });
      }
    }
  }, [editingProvider]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (
        data &&
        data.type === "providerApiKey" &&
        data.id === editingProvider?.id
      ) {
        if (typeof data.apiKey === "string") {
          setApiKey(data.apiKey);
        }
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, [editingProvider]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;

      if (!data || data.type !== "modelsDiscovered") {
        return;
      }

      setIsConnecting(false);

      if (data.error) {
        setStatus("error");
        setConnectionError(data.error);
        return;
      }

      setStatus("success");

      const chatModels: DiscoveredModel[] = (
        data.models ?? []
      ).filter(
        (model: DiscoveredModel) =>
          model.capabilities !== undefined,
      );

      setDiscoveredModels(chatModels);
      setModelSearchQuery("");

      if (editingProvider) {
        const existingProviderModels =
          existingModels.filter(
            (model) =>
              model.providerConfigId ===
              editingProvider.id,
          );

        const discoveredIds = new Set(
          chatModels.map((model) => model.id),
        );

        setSelectedIds(
          existingProviderModels
            .map((model) => model.id)
            .filter((id) => discoveredIds.has(id)),
        );
      } else {
        setSelectedIds([]);
      }
    };

    window.addEventListener("message", handler);

    return () => {
      window.removeEventListener("message", handler);
    };
  }, [editingProvider, existingModels]);

  const handleProviderChange = (
    nextProvider: ProviderType,
  ) => {
    setProviderType(nextProvider);
    setStatus("idle");
    setDiscoveredModels([]);
    setSelectedIds([]);
    setModelSearchQuery("");
    setConnectionError(null);
    setEndpoint("");
    setApiKey("");
  };

  const handleConnect = () => {
    setIsConnecting(true);
    setConnectionError(null);
    setStatus("loading");
    setDiscoveredModels([]);
    setSelectedIds([]);
    setModelSearchQuery("");

    const finalEndpoint =
      endpoint.trim() ||
      DEFAULT_ENDPOINTS[providerType] ||
      "";

    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "discoverModels",
        provider: providerType,
        endpoint: finalEndpoint || undefined,
        apiKey: apiKey.trim() || undefined,
      });
    }
  };

  const handleToggleModel = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter(
          (modelId) => modelId !== id,
        )
        : [...previous, id],
    );
  };

  const handleSave = () => {
    if (selectedIds.length === 0) {
      return;
    }

    const providerId =
      editingProvider?.id ??
      `${providerType}-${Date.now()}`;

    const finalEndpoint =
      endpoint.trim() ||
      DEFAULT_ENDPOINTS[providerType] ||
      "";

    const displayName =
      name.trim() ||
      `${PROVIDER_DISPLAY[providerType]?.label ?? providerType} Config`;

    const setting: ProviderSettings = {
      id: providerId,
      name: displayName,
      provider: providerType,
      endpoint: finalEndpoint || undefined,
      apiKeySecret:
        apiKey.trim().length > 0 ||
        Boolean(editingProvider?.apiKeySecret),
    };

    const newWorkspaceModels: WorkspaceModel[] =
      selectedIds.flatMap((id) => {
        const found = discoveredModels.find(
          (model) => model.id === id,
        );

        if (!found) {
          return [];
        }

        return [
          {
            id: found.id,
            displayName: found.displayName,
            providerConfigId: providerId,
            provider: providerType,
            capabilities: found.capabilities,
            contextLength: found.contextLength,
          },
        ];
      });


    const modelsWithoutCurrentProvider =
      existingModels.filter(
        (model) =>
          model.providerConfigId !== providerId,
      );

    const updatedWorkspaceModels = [
      ...modelsWithoutCurrentProvider,
      ...newWorkspaceModels,
    ];

    if ((window as any).vscode) {

      (window as any).vscode.postMessage({
        type: "saveProviderSetting",
        setting,
        apiKey: apiKey.trim() || undefined,
      });

      (window as any).vscode.postMessage({
        type: "saveWorkspaceModels",
        models: updatedWorkspaceModels,
      });
    }

    onSaved();
  };

  const modelQuery = modelSearchQuery.toLowerCase().trim();

  const filteredModels = discoveredModels.filter((m) => {
    if (!modelQuery) return true;
    return (
      (m.displayName && m.displayName.toLowerCase().includes(modelQuery)) ||
      (m.id && m.id.toLowerCase().includes(modelQuery))
    );
  });

  const hasQuery = modelQuery.length > 0;

  const needsApiKey =
    providerType !== "ollama";

  const needsEndpoint =
    providerType !== "anthropic";

  const labelClass =
    "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B96A9]";

  const inputClass = `
  box-border block h-10 w-full min-w-0 rounded-lg
  border border-white/[0.08] bg-[#090B11] px-3
  text-[13px] text-[#E5EAF1] placeholder:text-[#566074]
  shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]
  transition-all duration-150
  hover:border-white/[0.16]
  focus:outline-none focus:border-[#4A63C9] focus:ring-4 focus:ring-[#2F48A1]/20
`;

  const primaryBtnClass = `
  inline-flex h-10 w-full items-center justify-center gap-2 sm:w-auto
  rounded-lg border-0 px-5 text-[12.5px] font-semibold text-white
  bg-gradient-to-b from-[#3A57C2] to-[#2F48A1]
  shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_18px_-8px_rgba(47,72,161,0.8)]
  transition-all duration-200
  hover:from-[#4764D1] hover:to-[#3550B5] hover:-translate-y-px
  active:translate-y-0 active:scale-[0.98]
  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A63C9]/70
  focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
  disabled:translate-y-0 disabled:cursor-not-allowed
  disabled:from-[#2F48A1]/40 disabled:to-[#2F48A1]/40
  disabled:text-white/60 disabled:shadow-none
`;

  const secondaryBtnClass = `
  inline-flex h-10 w-full items-center justify-center sm:w-auto
  rounded-lg border border-white/[0.1] bg-transparent px-5
  text-[12.5px] font-medium text-[#B8C2D4]
  transition-colors duration-150
  hover:border-white/[0.2] hover:bg-white/[0.06] hover:text-[#F1F5F9]
  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A63C9]/70
`;

  return (
    <section
      className="
    box-border [&_*]:box-border
    rounded-2xl border border-white/[0.07]
    bg-gradient-to-b from-white/[0.035] to-white/[0.01]
    p-5 sm:p-7
    shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-24px_rgba(0,0,0,0.7)]
  "
    >
      {/* Header */}
      <div className="mb-6 flex items-start gap-3.5 border-b border-white/[0.06] pb-5">
        <div
          className="
        flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
        bg-[#2F48A1]/15 text-[#7C93E8]
        ring-1 ring-inset ring-[#2F48A1]/30
        shadow-[0_0_20px_-6px_rgba(47,72,161,0.6)]
      "
        >
          {isEditing ? (
            <PencilIcon className="h-5 w-5" />
          ) : (
            <PlusIcon className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-semibold leading-6 tracking-[-0.015em] text-[#F1F5F9]">
            {isEditing ? "Edit AI Provider" : "Add AI Provider"}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-[#8B96A9]">
            {isEditing
              ? "Update the connection and workspace models."
              : "Connect a provider and choose the models available in your workspace."}
          </p>
        </div>
      </div>

      <div className="flex max-w-[760px] flex-col gap-5">
        {/* Provider Type */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="provider-type-select" className={labelClass}>
            Provider
          </label>

          <div className="flex items-center gap-3">
            <div
              className="
            flex h-10 w-10 shrink-0 items-center justify-center rounded-lg
            bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]
          "
            >
              <ProviderIcon provider={providerType} />
            </div>

            <div className="relative w-full sm:max-w-[360px]">
              <select
                id="provider-type-select"
                value={providerType}
                onChange={(event) =>
                  handleProviderChange(event.target.value as ProviderType)
                }
                className={`${inputClass} cursor-pointer appearance-none pr-9`}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <ChevronDownIcon
                className="
              pointer-events-none absolute right-3 top-1/2
              h-4 w-4 -translate-y-1/2 text-[#6B778C]
            "
              />
            </div>
          </div>
        </div>

        {/* Name + Endpoint */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="config-name-input" className={labelClass}>
              Configuration Name
            </label>
            <input
              id="config-name-input"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`e.g. My ${PROVIDER_DISPLAY[providerType]?.label ?? providerType}`}
              className={inputClass}
            />
          </div>

          {needsEndpoint && (
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="endpoint-input" className={labelClass}>
                Endpoint
              </label>
              <input
                id="endpoint-input"
                type="text"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={DEFAULT_ENDPOINTS[providerType] || "http://localhost:11434"}
                className={`${inputClass} font-mono text-[12.5px]`}
              />
            </div>
          )}
        </div>

        {/* API Key */}
        {needsApiKey && (
          <div className="flex flex-col gap-1.5 sm:max-w-[520px]">
            <label htmlFor="api-key-input" className={labelClass}>
              API Key
            </label>

            <div className="relative">
              <KeyIcon
                className="
              pointer-events-none absolute left-3 top-1/2
              h-4 w-4 -translate-y-1/2 text-[#5E6A7E]
            "
              />

              <input
                id="api-key-input"
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Enter API key"
                className={`${inputClass} pl-9 pr-10`}
              />

              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                className="
              absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2
              items-center justify-center rounded-md border-0
              bg-transparent text-[#6B778C] transition-colors duration-150
              hover:bg-white/[0.06] hover:text-[#F1F5F9]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            "
              >
                {showApiKey ? (
                  <EyeSlashIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div
            role="alert"
            className="
          flex items-start gap-2.5 rounded-lg
          border border-red-500/25 bg-red-500/[0.07]
          px-3.5 py-3 text-[12.5px] leading-5 text-red-300
        "
          >
            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span className="min-w-0 break-words">
              {connectionError || "Unable to connect to the provider."}
            </span>
          </div>
        )}

        {/* Models */}
        {status === "success" && (
          <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div
                className="
              flex h-6 w-6 items-center justify-center rounded-md
              bg-emerald-500/10 text-emerald-400
              ring-1 ring-inset ring-emerald-500/20
            "
              >
                <CheckCircleIcon className="h-3.5 w-3.5" />
              </div>

              <span className="text-[13px] font-semibold text-[#F1F5F9]">
                Workspace Models
              </span>

              <span
                className="
              rounded-full bg-white/[0.05] px-2 py-0.5
              text-[11px] font-medium tabular-nums text-[#8B96A9]
              ring-1 ring-inset ring-white/[0.06]
            "
              >
                {discoveredModels.length} available
              </span>

              {selectedIds.length > 0 && (
                <span
                  className="
                rounded-full bg-[#2F48A1]/20 px-2 py-0.5
                text-[11px] font-medium tabular-nums text-[#9DB0F0]
                ring-1 ring-inset ring-[#2F48A1]/30
              "
                >
                  {selectedIds.length} active
                </span>
              )}
            </div>

            <p
              className="
            m-0 rounded-lg border border-white/[0.06] bg-white/[0.03]
            px-3 py-2 text-[12px] leading-5 text-[#8B96A9]
          "
            >
              <span className="font-semibold text-[#B8C2D4]">Note:</span> Please
              select only the models that are accessible with your provided API key.
            </p>

            {/* Search Bar & Quick Select */}


            {discoveredModels.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {/* Search */}
                <div className="relative flex items-center">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute left-3 h-4 w-4 text-[#5E6A7E]"
                  />
                  <input
                    type="text"
                    data-testid="provider-model-search"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search discovered models..."
                    aria-label="Search discovered models"
                    className="
          h-10 w-full rounded-lg border border-white/[0.08] bg-[#0A0D13]
          pl-9 pr-10 text-[13px] text-[#F1F5F9] outline-none
          placeholder:text-[#5E6A7E] transition-colors duration-150
          hover:border-white/[0.16]
          focus:border-[#2F48A1] focus:ring-2 focus:ring-[#2F48A1]/30
        "
                  />
                  {modelSearchQuery && (
                    <button
                      type="button"
                      data-testid="clear-provider-model-search"
                      onClick={() => setModelSearchQuery("")}
                      title="Clear search"
                      aria-label="Clear search"
                      className="
            absolute right-1.5 flex h-7 w-7 items-center justify-center
            rounded-md border-0 bg-transparent text-[#6B778C]
            transition-colors duration-150
            hover:bg-white/[0.06] hover:text-[#F1F5F9]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          "
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Status + bulk actions */}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B96A9]">
                    <span className="tabular-nums">
                      {hasQuery
                        ? `Showing ${filteredModels.length} of ${discoveredModels.length} models`
                        : `${discoveredModels.length} models found`}
                    </span>

                    <span
                      className="
            rounded-full bg-[#2F48A1]/20 px-2 py-0.5
            text-[11px] font-medium tabular-nums text-[#9DB0F0]
            ring-1 ring-inset ring-[#2F48A1]/30
          "
                    >
                      {selectedIds.length} selected
                    </span>
                  </div>

                  {filteredModels.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const idsToAdd = filteredModels.map((m) => m.id);
                          setSelectedIds((prev) =>
                            Array.from(new Set([...prev, ...idsToAdd])),
                          );
                        }}
                        className="
              rounded-md border-0 bg-transparent px-2 py-1
              text-[12px] font-medium text-[#8FA5F0]
              transition-colors duration-150 cursor-pointer
              hover:bg-[#2F48A1]/15 hover:text-[#B4C2F5]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            "
                      >
                        Select all{hasQuery ? " matching" : ""}
                      </button>

                      <span aria-hidden="true" className="h-3 w-px bg-white/[0.1]" />

                      <button
                        type="button"
                        onClick={() => {
                          const idsToRemove = new Set(filteredModels.map((m) => m.id));
                          setSelectedIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
                        }}
                        className="
              rounded-md border-0 bg-transparent px-2 py-1
              text-[12px] font-medium text-[#8B96A9]
              transition-colors duration-150 cursor-pointer
              hover:bg-white/[0.06] hover:text-[#F1F5F9]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            "
                      >
                        Deselect all{hasQuery ? " matching" : ""}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {discoveredModels.length === 0 ? (
              <div
                className="
              rounded-lg border border-dashed border-white/[0.1]
              bg-white/[0.02] px-4 py-6 text-center
              text-[12.5px] text-[#8B96A9]
            "
              >
                No chat-capable models found.
              </div>
            ) : (() => {
              const q = modelSearchQuery.toLowerCase().trim();
              const filtered = discoveredModels.filter((m) => {
                if (!q) return true;
                return (
                  (m.displayName && m.displayName.toLowerCase().includes(q)) ||
                  (m.id && m.id.toLowerCase().includes(q))
                );
              });

              if (filtered.length === 0) {
                return (
                  <div
                    className="
                      rounded-lg border border-dashed border-white/[0.1]
                      bg-white/[0.02] px-4 py-6 text-center
                      text-[12.5px] text-[#8B96A9]
                    "
                  >
                    No models found matching "{modelSearchQuery}"
                  </div>
                );
              }

              return (
                <div
                  className="
                    flex max-h-[300px] flex-col gap-1 overflow-y-auto
                    rounded-xl border border-white/[0.06] bg-[#0A0D13] p-1.5
                  "
                >
                  {filtered.map((model) => {
                    const selected = selectedIds.includes(model.id);

                    return (
                      <label
                        key={model.id}
                        className={`
                          flex cursor-pointer items-start gap-3 rounded-lg border
                          p-3 transition-colors duration-150
                          ${selected
                            ? "border-[#2F48A1]/50 bg-[#2F48A1]/[0.12]"
                            : "border-transparent hover:bg-white/[0.04]"
                          }
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => handleToggleModel(model.id)}
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#2F48A1]"
                        />

                        <div className="min-w-0">
                          <div
                            className={`
                              truncate text-[12.5px] font-medium leading-5
                              ${selected ? "text-[#F1F5F9]" : "text-[#D5DCE8]"}
                            `}
                          >
                            {model.displayName}
                          </div>

                          <CapabilityChips capabilities={model.capabilities} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Actions */}
        <div
          className="
        mt-1 flex flex-col-reverse gap-2.5 border-t border-white/[0.06] pt-5
        sm:flex-row sm:items-center
      "
        >
          {status !== "success" ? (
            <button
              id="connect-discover-btn"
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="
            group inline-flex h-10 w-full items-center justify-center gap-2
            rounded-lg border-0 bg-[#2F48A1] px-4
            text-[12.5px] font-medium text-white
            shadow-md shadow-[#2F48A1]/30
            transition-all duration-200
            hover:-translate-y-px hover:bg-[#3A57C2]
            active:translate-y-0 active:scale-[0.98]
            focus:outline-none
            focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
            disabled:translate-y-0 disabled:cursor-not-allowed
            disabled:bg-[#2F48A1]/40 disabled:text-white/60 disabled:shadow-none
            sm:w-auto
          "
            >
              {isConnecting ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                </svg>
              ) : (
                <ServerIcon className="h-4 w-4" />
              )}

              {isConnecting ? "Connecting..." : "Connect & Discover Models"}
            </button>
          ) : (
            <button
              id="save-provider-btn"
              type="button"
              onClick={handleSave}
              disabled={selectedIds.length === 0}
              className="
            inline-flex h-10 w-full items-center justify-center
            rounded-lg border-0 bg-[#2F48A1] px-5
            text-[12.5px] font-medium text-white
            shadow-md shadow-[#2F48A1]/30
            transition-all duration-200
            hover:-translate-y-px hover:bg-[#3A57C2]
            active:translate-y-0 active:scale-[0.98]
            focus:outline-none
            focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
            focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
            disabled:translate-y-0 disabled:cursor-not-allowed
            disabled:bg-[#2F48A1]/40 disabled:text-white/60 disabled:shadow-none
            sm:w-auto
          "
            >
              {isEditing
                ? "Save Changes"
                : selectedIds.length > 0
                  ? `Add ${selectedIds.length} ${selectedIds.length === 1 ? "Model" : "Models"}`
                  : "Add Provider"}
            </button>
          )}

          <button
            id="cancel-provider-btn"
            type="button"
            onClick={onCancel}
            className="
          inline-flex h-10 w-full items-center justify-center
          rounded-lg border border-white/[0.1] bg-transparent px-5
          text-[12.5px] font-medium text-[#B8C2D4]
          transition-colors duration-150
          hover:bg-white/[0.06] hover:text-[#F1F5F9]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          sm:w-auto
        "
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

// Main settings tab for managing AI providers, configuring credentials, and syncing models.
export function ProvidersSettings() {
  const [providers, setProviders] =
    useState<ProviderSettings[]>([]);

  const [workspaceModels, setWorkspaceModels] =
    useState<WorkspaceModel[]>([]);

  const [showAddForm, setShowAddForm] =
    useState(false);

  const [editingProvider, setEditingProvider] =
    useState<ProviderSettings | null>(null);

  useEffect(() => {
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "getSettings",
      });
    }

    const handler = (event: MessageEvent) => {
      const data = event.data;

      if (!data || data.type !== "settingsData") {
        return;
      }

      if (Array.isArray(data.providers)) {
        setProviders(data.providers);
      }

      if (Array.isArray(data.workspaceModels)) {
        setWorkspaceModels(data.workspaceModels);
      }
    };

    window.addEventListener("message", handler);

    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      if (!(window as any).vscode) {
        return;
      }

      const updatedModels =
        workspaceModels.filter(
          (model) =>
            model.providerConfigId !== id,
        );

      (window as any).vscode.postMessage({
        type: "saveWorkspaceModels",
        models: updatedModels,
      });

      (window as any).vscode.postMessage({
        type: "deleteProviderSetting",
        id,
      });

      setProviders((previous) =>
        previous.filter(
          (provider) => provider.id !== id,
        ),
      );

      setWorkspaceModels(updatedModels);

      if (editingProvider?.id === id) {
        setEditingProvider(null);
      }
    },
    [workspaceModels, editingProvider],
  );


  const handleEdit = useCallback(
    (provider: ProviderSettings) => {
      setShowAddForm(false);
      setEditingProvider(provider);
    },
    [],
  );


  const handleFormSaved = () => {
    setShowAddForm(false);
    setEditingProvider(null);


    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "getSettings",
      });
    }
  };


  const handleFormCancel = () => {
    setShowAddForm(false);
    setEditingProvider(null);
  };

  return (
    <div className="flex flex-col gap-7">


      <section>
        {/* Section header */}
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="m-0 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[#F1F5F9]">
              Configured Providers
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-5 text-[#8B96A9]">
              AI connections available in this workspace.
            </p>
          </div>

          {providers.length > 0 && (
            <span
              className="
          shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1
          text-[11px] font-medium tabular-nums text-[#8B96A9]
          ring-1 ring-inset ring-white/[0.06]
        "
            >
              {providers.length} {providers.length === 1 ? "provider" : "providers"}
            </span>
          )}
        </div>

        {providers.length === 0 ? (
          <div
            id="empty-providers-state"
            className="
        relative flex flex-col items-center overflow-hidden
        rounded-xl border border-dashed border-white/[0.1]
        bg-gradient-to-b from-white/[0.03] to-transparent
        px-6 py-10 text-center
      "
          >
            {/* Soft glow */}
            <div
              aria-hidden="true"
              className="
          pointer-events-none absolute -top-16 left-1/2 h-32 w-56
          -translate-x-1/2 rounded-full bg-[#2F48A1]/20 blur-3xl
        "
            />

            {/* Icon tile */}
            <div
              className="
          relative mb-4 flex h-11 w-11 items-center justify-center
          rounded-xl bg-[#2F48A1]/15 text-[#7C93E8]
          ring-1 ring-inset ring-[#2F48A1]/30
          shadow-[0_0_20px_-6px_rgba(47,72,161,0.6)]
        "
            >
              <ServerIcon className="h-5 w-5" />
            </div>

            <p className="relative m-0 text-[14px] font-semibold leading-5 text-[#F1F5F9]">
              No AI providers configured.
            </p>

            <p className="relative mb-5 mt-1.5 max-w-[420px] text-[12.5px] leading-5 text-[#8B96A9]">
              Add a provider to make its models available in Kodra.
            </p>

            {/* <button
              id="add-provider-btn"
              type="button"
              onClick={() => {
                setEditingProvider(null);
                setShowAddForm(true);
              }}
              className="
          group relative inline-flex h-9 items-center justify-center gap-2
          rounded-lg border-0 bg-[#2F48A1] px-4
          text-[12.5px] font-medium text-white
          shadow-md shadow-[#2F48A1]/30
          transition-all duration-200
          hover:-translate-y-px hover:bg-[#3A57C2]
          active:translate-y-0 active:scale-[0.98]
          focus:outline-none
          focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
          focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D1017]
        "
            >
              <PlusIcon
                className="
            h-4 w-4 transition-transform duration-200
            group-hover:rotate-90
          "
              />
              Add AI Provider
            </button> */}
            <button
              id="add-provider-btn"
              type="button"
              onClick={() => {
                setEditingProvider(null);
                setShowAddForm(true);
              }}
              className="
    inline-flex h-9 items-center justify-center gap-1.5
    rounded-md border-0 bg-[#2F48A1] px-3.5
    text-[13px] font-medium text-white
    transition-colors duration-150
    hover:bg-[#3A57C2] active:bg-[#283F8F]
    focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F48A1]/60
  "
            >
              <PlusIcon className="h-4 w-4" />
              Add AI Provider
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 overflow-visible">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                models={workspaceModels.filter(
                  (model) => model.providerConfigId === provider.id,
                )}
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}
      </section>


      {(!showAddForm && !editingProvider && providers.length > 0) && (
        <section>
          <button
            id="add-provider-btn"
            type="button"
            onClick={() => {
              setEditingProvider(null);
              setShowAddForm(true);
            }}
            className="
              inline-flex
              min-h-[36px]
              items-center
              justify-center
              gap-2
              rounded-[7px]
              border
              border-[#4F46E5]
              bg-[#4F46E5]
              px-3.5
              text-[12px]
              font-medium
              text-white
              transition-all
              hover:bg-[#4338CA]
              focus:outline-none
              focus-visible:ring-2
              focus-visible:ring-[#6366F1]/30
            "
          >
            <PlusIcon className="h-4 w-4" />
            Add AI Provider
          </button>
        </section>
      )}
      {(showAddForm || editingProvider) && (
        <AddProviderForm
          onCancel={handleFormCancel}
          onSaved={handleFormSaved}
          existingModels={workspaceModels}
          editingProvider={editingProvider}
        />
      )}
    </div>
  );
}