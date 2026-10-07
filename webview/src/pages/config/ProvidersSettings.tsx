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
} from "@heroicons/react/24/outline";
import {
  Anthropic,
  Gemini,
  Ollama,
  OpenAI,
  Groq,
} from "@lobehub/icons";
import {
  DiscoveredModel,
  ProviderSettings,
  WorkspaceModel,
} from "../../../../src/providers/types";

type ProviderType = "ollama" | "openai" | "anthropic" | "gemini" | "groq";

const PROVIDER_DISPLAY: Record<
  ProviderType,
  { label: string }
> = {
  ollama: { label: "Ollama" },
  openai: { label: "OpenAI" },
  anthropic: { label: "Anthropic" },
  gemini: { label: "Google Gemini" },
  groq: { label: "Groq" },
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
];

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "",
  groq: "https://api.groq.com/openai/v1",
};


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

/* -------------------------------------------------------------------------- */
/* Provider Card                                                               */
/* -------------------------------------------------------------------------- */

interface ProviderCardProps {
  provider: ProviderSettings;
  models: WorkspaceModel[];
  onDelete: (id: string) => void;
  onEdit: (provider: ProviderSettings) => void;
}

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

  const visibleModels = models.slice(0, 3);
  const extraCount = Math.max(0, models.length - 3);

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
              Delete
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

  const needsApiKey =
    providerType !== "ollama";

  const needsEndpoint =
    providerType !== "anthropic";

  return (
    <section
      className="
        rounded-[10px]
        border
        border-[#1E2333]
        bg-[#11141C]
        p-5
      "
    >
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className="
                flex
                h-8
                w-8
                items-center
                justify-center
                rounded-[7px]
                border
                border-[#2A3142]
                bg-[#171B26]
              "
            >
              {isEditing ? (
                <PencilIcon className="h-4 w-4 text-[#A5B4FC]" />
              ) : (
                <PlusIcon className="h-4 w-4 text-[#A5B4FC]" />
              )}
            </div>

            <h2 className="m-0 text-[17px] font-semibold leading-6 text-[#F1F5F9]">
              {isEditing
                ? "Edit AI Provider"
                : "Add AI Provider"}
            </h2>
          </div>

          <p className="mt-1.5 text-[12px] leading-[18px] text-[#7D8798]">
            {isEditing
              ? "Update the connection and workspace models."
              : "Connect a provider and choose the models available in your workspace."}
          </p>
        </div>
      </div>

      <div className="flex max-w-[760px] flex-col gap-5">
        {/* Provider Type */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="provider-type-select"
            className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#94A3B8]"
          >
            Provider
          </label>

          <div className="flex items-center gap-3">
            <ProviderIcon provider={providerType} />

            <div className="relative w-full max-w-[360px]">
              <select
                id="provider-type-select"
                value={providerType}
                onChange={(event) =>
                  handleProviderChange(
                    event.target.value as ProviderType,
                  )
                }
                className="
                  h-10
                  w-full
                  appearance-none
                  rounded-[7px]
                  border
                  border-[#282F40]
                  bg-[#0C0F15]
                  px-3
                  pr-9
                  text-[13px]
                  text-[#E5EAF1]
                  outline-none
                  transition-colors
                  hover:border-[#394258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/15
                "
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>

              <ChevronDownIcon
                className="
                  pointer-events-none
                  absolute
                  right-3
                  top-1/2
                  h-4
                  w-4
                  -translate-y-1/2
                  text-[#697386]
                "
              />
            </div>
          </div>
        </div>

        {/* Name + Endpoint */}
        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="config-name-input"
              className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#94A3B8]"
            >
              Configuration Name
            </label>

            <input
              id="config-name-input"
              type="text"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder={`e.g. My ${
                PROVIDER_DISPLAY[providerType]?.label ??
                providerType
              }`}
              className="
                h-10
                w-full
                rounded-[7px]
                border
                border-[#282F40]
                bg-[#0C0F15]
                px-3
                text-[13px]
                text-[#F1F5F9]
                outline-none
                placeholder:text-[#566174]
                transition-colors
                hover:border-[#394258]
                focus:border-[#6366F1]
                focus:ring-2
                focus:ring-[#6366F1]/15
              "
            />
          </div>

          {needsEndpoint && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="endpoint-input"
                className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#94A3B8]"
              >
                Endpoint
              </label>

              <input
                id="endpoint-input"
                type="text"
                value={endpoint}
                onChange={(event) =>
                  setEndpoint(event.target.value)
                }
                placeholder={
                  DEFAULT_ENDPOINTS[providerType] ||
                  "http://localhost:11434"
                }
                className="
                  h-10
                  w-full
                  rounded-[7px]
                  border
                  border-[#282F40]
                  bg-[#0C0F15]
                  px-3
                  text-[13px]
                  text-[#F1F5F9]
                  outline-none
                  placeholder:text-[#566174]
                  transition-colors
                  hover:border-[#394258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/15
                "
              />
            </div>
          )}
        </div>

        {/* API Key */}
        {needsApiKey && (
          <div className="flex max-w-[520px] flex-col gap-1.5">
            <label
              htmlFor="api-key-input"
              className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#94A3B8]"
            >
              API Key
            </label>

            <div className="relative">
              <KeyIcon
                className="
                  pointer-events-none
                  absolute
                  left-3
                  top-1/2
                  h-4
                  w-4
                  -translate-y-1/2
                  text-[#566174]
                "
              />

              <input
                id="api-key-input"
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) =>
                  setApiKey(event.target.value)
                }
                placeholder={
                  isEditing
                    ? "Leave blank to keep existing key"
                    : "Enter API key"
                }
                className="
                  h-10
                  w-full
                  rounded-[7px]
                  border
                  border-[#282F40]
                  bg-[#0C0F15]
                  pl-9
                  pr-3
                  text-[13px]
                  text-[#F1F5F9]
                  outline-none
                  placeholder:text-[#566174]
                  transition-colors
                  hover:border-[#394258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/15
                "
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#566174] hover:text-[#8C96A8] focus:outline-none"
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
            className="
              flex
              items-start
              gap-2
              rounded-[7px]
              border
              border-[#EF4444]/25
              bg-[#EF4444]/[0.06]
              p-3
              text-[12px]
              leading-[18px]
              text-[#FCA5A5]
            "
          >
            <XCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />

            <span>
              {connectionError ||
                "Unable to connect to the provider."}
            </span>
          </div>
        )}

        {/* Models */}
        {status === "success" && (
          <div
            className="
              flex
              flex-col
              gap-3
              border-t
              border-[#1E2333]
              pt-5
            "
          >
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-4 w-4 text-[#4ADE80]" />

              <span className="text-[13px] font-medium text-[#E8EDF4]">
                Workspace Models
              </span>

              <span className="text-[11px] text-[#5F6979]">
                {discoveredModels.length} available
              </span>
            </div>

            <p className="mt-1.5 mb-2 text-[11.5px] leading-relaxed text-[#94A3B8]">
              <span className="font-medium text-[#A3ADC2]">Note:</span> Please select only the models that are accessible with your provided API key.
            </p>

            {discoveredModels.length === 0 ? (
              <div
                className="
                  rounded-[7px]
                  border
                  border-[#1E2333]
                  bg-[#0C0E14]
                  px-4
                  py-4
                  text-[12px]
                  text-[#7D8798]
                "
              >
                No chat-capable models found.
              </div>
            ) : (
              <div
                className="
                  flex
                  max-h-[280px]
                  flex-col
                  gap-1
                  overflow-y-auto
                  rounded-[8px]
                  border
                  border-[#1E2333]
                  bg-[#0C0E14]
                  p-2
                "
              >
                {discoveredModels.map((model) => {
                  const selected =
                    selectedIds.includes(model.id);

                  return (
                    <label
                      key={model.id}
                      className={`
                        flex
                        cursor-pointer
                        items-start
                        gap-3
                        rounded-[7px]
                        border
                        p-3
                        transition-colors
                        ${
                          selected
                            ? "border-[#6366F1]/45 bg-[#181C2A]"
                            : "border-transparent hover:bg-[#151924]"
                        }
                      `}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          handleToggleModel(model.id)
                        }
                        className="
                          mt-1
                          h-4
                          w-4
                          flex-shrink-0
                          accent-[#6366F1]
                        "
                      />

                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium leading-5 text-[#E5EAF1]">
                          {model.displayName}
                        </div>

                        <CapabilityChips
                          capabilities={model.capabilities}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-1 flex items-center gap-2">
          {status !== "success" ? (
            <button
              id="connect-discover-btn"
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="
                inline-flex
                min-h-[38px]
                items-center
                justify-center
                gap-2
                rounded-[7px]
                border
                border-[#6366F1]
                bg-[#4F46E5]
                px-4
                text-[12px]
                font-medium
                text-white
                transition-all
                hover:border-[#4F46E5]
                hover:bg-[#4338CA]
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-[#6366F1]/30
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              <ServerIcon className="h-4 w-4" />

              {isConnecting
                ? "Connecting..."
                : "Connect & Discover Models"}
            </button>
          ) : (
            <button
              id="save-provider-btn"
              type="button"
              onClick={handleSave}
              disabled={selectedIds.length === 0}
              className="
                inline-flex
                min-h-[38px]
                items-center
                justify-center
                rounded-[7px]
                border
                border-[#6366F1]
                bg-[#4F46E5]
                px-4
                text-[12px]
                font-medium
                text-white
                transition-all
                hover:border-[#4F46E5]
                hover:bg-[#4338CA]
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-[#6366F1]/30
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {isEditing
                ? "Save Changes"
                : "Add Provider"}
            </button>
          )}

          <button
            id="cancel-provider-btn"
            type="button"
            onClick={onCancel}
            className="
              inline-flex
              min-h-[38px]
              items-center
              justify-center
              rounded-[7px]
              border
              border-[#282F40]
              bg-transparent
              px-4
              text-[12px]
              font-medium
              text-[#AEB8C7]
              transition-colors
              hover:border-[#394258]
              hover:bg-[#171C26]
              hover:text-[#E7ECF3]
              focus:outline-none
              focus-visible:ring-2
              focus-visible:ring-[#6366F1]/20
            "
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

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
        <div className="mb-3.5">
          <h2 className="m-0 text-[16px] font-semibold leading-6 text-[#F1F5F9]">
            Configured Providers
          </h2>

          <p className="mt-1 text-[12px] leading-[18px] text-[#727D8F]">
            AI connections available in this workspace.
          </p>
        </div>

        {providers.length === 0 ? (
          <div
            id="empty-providers-state"
            className="
              flex
              flex-col
              items-start
              rounded-[9px]
              border
              border-dashed
              border-[#282F40]
              bg-[#11141C]
              px-5
              py-6
            "
          >
            <div
              className="
                mb-3
                flex
                h-9
                w-9
                items-center
                justify-center
                rounded-[7px]
                border
                border-[#293144]
                bg-[#181D28]
              "
            >
              <ServerIcon className="h-4 w-4 text-[#818CF8]" />
            </div>

            <p className="m-0 text-[13px] font-medium leading-5 text-[#E7ECF3]">
              No AI providers configured.
            </p>

            <p className="mt-1 mb-4 max-w-[520px] text-[12px] leading-[18px] text-[#667085]">
              Add a provider to make its models available in Kodra.
            </p>
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
          </div>
        ) : (
          <div
            className="
              flex
              flex-col
              gap-2
              overflow-visible
            "
          >
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                models={workspaceModels.filter(
                  (model) =>
                    model.providerConfigId ===
                    provider.id,
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