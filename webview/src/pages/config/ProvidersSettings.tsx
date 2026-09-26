import React, { useState, useEffect, useCallback } from "react";
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
} from "@heroicons/react/24/outline";
import {
  Anthropic,
  OpenAI,
  Gemini,
  Ollama,
} from "@lobehub/icons";
import {
  DiscoveredModel,
  ProviderSettings,
  WorkspaceModel,
} from "../../../../src/providers/types";

type ProviderType = "ollama" | "openai" | "anthropic" | "gemini";

const PROVIDER_DISPLAY: Record<
  ProviderType,
  { label: string; icon: string }
> = {
  ollama: { label: "Ollama", icon: "Ollama" },
  openai: { label: "OpenAI", icon: "OpenAI" },
  anthropic: { label: "Anthropic", icon: "Anthropic" },
  gemini: { label: "Google Gemini", icon: "Gemini" },
};

const PROVIDER_OPTIONS: {
  value: ProviderType;
  label: string;
}[] = [
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
];

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "",
};

/* -------------------------------------------------------------------------- */
/* Provider Icon                                                               */
/* -------------------------------------------------------------------------- */

export function ProviderIcon({
  provider,
  size = 22,
  className = "",
}: {
  provider: string;
  size?: number | string;
  className?: string;
}) {
  const styles: Record<string, string> = {
    ollama: "bg-[#161A26] text-[#E2E8F0] border-[#262D3E]",
    openai: "bg-[#10241E] text-[#10A37F] border-[#18483B]",
    anthropic: "bg-[#241C18] text-[#D4A373] border-[#3B2C24]",
    gemini: "bg-[#141F33] text-[#93C5FD] border-[#223554]",
  };

  const renderIcon = () => {
    const key = (provider || "").toLowerCase();
    if (key.includes("ollama")) {
      return <Ollama size={size} className="text-[#E2E8F0]" />;
    }
    if (key.includes("openai")) {
      return <OpenAI size={size} className="text-[#10A37F]" />;
    }
    if (key.includes("anthropic") || key.includes("claude")) {
      return <Anthropic size={size} className="text-[#D4A373]" />;
    }
    if (key.includes("gemini") || key.includes("google")) {
      return <Gemini.Color size={size} />;
    }
    return (
      <span className="text-[15px] font-semibold text-[#E2E8F0]">
        {provider.charAt(0).toUpperCase()}
      </span>
    );
  };

  return (
    <div
      className={`
        flex h-11 w-11 flex-shrink-0 items-center justify-center
        rounded-[8px]
        border
        ${styles[provider.toLowerCase()] ?? "bg-[#161A26] text-[#E2E8F0] border-[#262D3E]"}
        ${className}
      `}
    >
      {renderIcon()}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Capability Chips                                                            */
/* -------------------------------------------------------------------------- */

function CapabilityChips({
  capabilities,
}: {
  capabilities: DiscoveredModel["capabilities"];
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {capabilities.toolCalling && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-2 text-[11px] text-[#CBD5E1]">
          <WrenchScrewdriverIcon className="h-3 w-3 text-[#818CF8]" />
          Tools
        </span>
      )}

      {capabilities.vision && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-2 text-[11px] text-[#CBD5E1]">
          <PhotoIcon className="h-3 w-3 text-[#818CF8]" />
          Vision
        </span>
      )}

      {capabilities.reasoning && (
        <span className="inline-flex h-6 items-center gap-1 rounded-full border border-[#262D3E] bg-[#161A26] px-2 text-[11px] text-[#CBD5E1]">
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

function ModelChip({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="
        inline-flex h-6 max-w-[180px] items-center
        overflow-hidden text-ellipsis whitespace-nowrap
        rounded-full border border-[#262D3E]
        bg-[#161A26]
        px-2
        text-[11px] leading-4
        text-[#CBD5E1]
      "
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
}

function ProviderCard({
  provider,
  models,
  onDelete,
}: ProviderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleModels = models.slice(0, 2);
  const extraCount = Math.max(0, models.length - 2);

  return (
    <div
      className="
        grid min-h-[72px] grid-cols-[minmax(220px,1.4fr)_minmax(150px,.9fr)_minmax(220px,1.5fr)_40px]
        items-center gap-5
        rounded-[10px]
        border border-[#1E2333]
        bg-[#12151E]
        p-4
        transition-colors duration-150
        hover:border-[#2F374C]
        hover:bg-[#161A26]
      "
    >
      {/* Provider identity */}
      <div className="flex min-w-0 items-center gap-3">
        <ProviderIcon provider={provider.provider} />

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              title={provider.name}
              className="truncate text-[14px] font-semibold leading-5 text-[#F1F5F9]"
            >
              {provider.name}
            </span>

            <span className="inline-flex h-[22px] flex-shrink-0 items-center rounded-full border border-[#262D3E] bg-[#161A26] px-2 text-[11px] text-[#CBD5E1]">
              {PROVIDER_DISPLAY[
                provider.provider as ProviderType
              ]?.label ?? provider.provider}
            </span>
          </div>

          <div className="mt-1 text-[12px] leading-[17px] text-[#94A3B8]">
            {models.length} model
            {models.length !== 1 ? "s" : ""} selected
          </div>
        </div>
      </div>

      {/* Connection */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] font-medium leading-[18px] text-[#4ADE80]">
          <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
          Connected
        </div>

        {provider.endpoint && (
          <div
            title={provider.endpoint}
            className="mt-0.5 truncate text-[11px] leading-[17px] text-[#8B95A5]"
          >
            {provider.endpoint}
          </div>
        )}
      </div>

      {/* Selected models */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleModels.map((model) => (
          <ModelChip
            key={model.id}
            name={model.displayName}
          />
        ))}

        {extraCount > 0 && (
          <ModelChip name={`+${extraCount}`} />
        )}
      </div>

      {/* Actions */}
      <div className="relative flex justify-end">
        <button
          type="button"
          onClick={() => setMenuOpen((previous) => !previous)}
          aria-label={`Actions for ${provider.name}`}
          className="
            flex h-9 w-9 items-center justify-center
            rounded-[6px]
            border border-[#262D3E]
            bg-[#151924]
            text-[#94A3B8]
            transition-colors
            hover:border-[#38425A]
            hover:bg-[#1C2233]
            hover:text-[#F1F5F9]
            focus:outline-none
            focus-visible:ring-2
            focus-visible:ring-[#6366F1]/30
          "
        >
          <EllipsisHorizontalIcon className="h-5 w-5" />
        </button>

        {menuOpen && (
          <div
            className="
              absolute right-0 top-11 z-50
              min-w-[140px]
              overflow-hidden
              rounded-[7px]
              border border-[#283044]
              bg-[#131722]
              py-1
              shadow-[0_8px_24px_rgba(0,0,0,.5)]
            "
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete(provider.id);
              }}
              className="
                flex w-full items-center gap-2
                border-0 bg-transparent
                px-3 py-2
                text-left text-[13px]
                text-[#F87171]
                transition-colors
                hover:bg-[#1E1822]
              "
            >
              <TrashIcon className="h-4 w-4" />
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add Provider Form                                                           */
/* -------------------------------------------------------------------------- */

type DiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

interface AddProviderFormProps {
  onCancel: () => void;
  onSaved: () => void;
  existingModels: WorkspaceModel[];
}

function AddProviderForm({
  onCancel,
  onSaved,
  existingModels,
}: AddProviderFormProps) {
  const [providerType, setProviderType] =
    useState<ProviderType>("ollama");

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");

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

      /*
       * Keep the existing capability contract.
       * The provider/backend remains responsible for determining
       * actual model capabilities.
       */
      const chatModels: DiscoveredModel[] = (
        data.models ?? []
      ).filter(
        (model: DiscoveredModel) =>
          model.capabilities !== undefined,
      );

      setDiscoveredModels(chatModels);
    };

    window.addEventListener("message", handler);

    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

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
        ? previous.filter((modelId) => modelId !== id)
        : [...previous, id],
    );
  };

  const handleSave = () => {
    if (selectedIds.length === 0) {
      return;
    }

    const newId = `${providerType}-${Date.now()}`;

    const finalEndpoint =
      endpoint.trim() ||
      DEFAULT_ENDPOINTS[providerType] ||
      "";

    const displayName =
      name.trim() ||
      `${PROVIDER_DISPLAY[providerType]?.label ?? providerType} Config`;

    const setting: ProviderSettings = {
      id: newId,
      name: displayName,
      provider: providerType,
      endpoint: finalEndpoint || undefined,
      apiKeySecret: apiKey.trim().length > 0,
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
            providerConfigId: newId,
            provider: providerType,
            capabilities: found.capabilities,
            contextLength: found.contextLength,
          },
        ];
      });

    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "saveProviderSetting",
        setting,
        apiKey: apiKey.trim() || undefined,
      });

      (window as any).vscode.postMessage({
        type: "saveWorkspaceModels",
        models: [
          ...existingModels,
          ...newWorkspaceModels,
        ],
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
        border border-[#1E2333]
        bg-[#12151E]
        p-5
      "
    >
      {/* Form header */}
      <div className="mb-6">
        <h2 className="m-0 text-[18px] font-semibold leading-6 text-[#F1F5F9]">
          Add AI Provider
        </h2>

        <p className="mt-1 text-[13px] leading-[19px] text-[#94A3B8]">
          Add a provider, connect, and select models
          to use in your workspace.
        </p>
      </div>

      <div className="flex max-w-[760px] flex-col gap-5">
        {/* Provider Type */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="provider-type-select"
            className="text-[12px] font-medium leading-[18px] text-[#CBD5E1]"
          >
            Provider Type
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
                  h-10 w-full appearance-none
                  rounded-[6px]
                  border border-[#262D3D]
                  bg-[#0C0E14]
                  px-3 pr-9
                  text-[14px] text-[#F1F5F9]
                  outline-none
                  transition-colors
                  hover:border-[#384258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/20
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
                  absolute right-3 top-1/2
                  h-4 w-4
                  -translate-y-1/2
                  text-[#94A3B8]
                "
              />
            </div>
          </div>
        </div>

        {/* Name + Endpoint */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="config-name-input"
              className="text-[12px] font-medium leading-[18px] text-[#CBD5E1]"
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
                h-10 w-full
                rounded-[6px]
                border border-[#262D3D]
                bg-[#0C0E14]
                px-3
                text-[14px] text-[#F1F5F9]
                outline-none
                placeholder:text-[#64748B]
                transition-colors
                hover:border-[#384258]
                focus:border-[#6366F1]
                focus:ring-2
                focus:ring-[#6366F1]/20
              "
            />
          </div>

          {needsEndpoint && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="endpoint-input"
                className="text-[12px] font-medium leading-[18px] text-[#CBD5E1]"
              >
                Endpoint URL
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
                  h-10 w-full
                  rounded-[6px]
                  border border-[#262D3D]
                  bg-[#0C0E14]
                  px-3
                  text-[14px] text-[#F1F5F9]
                  outline-none
                  placeholder:text-[#64748B]
                  transition-colors
                  hover:border-[#384258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/20
                "
              />

              <span className="text-[11px] leading-4 text-[#64748B]">
                Leave empty to use the default endpoint.
              </span>
            </div>
          )}
        </div>

        {/* API Key */}
        {needsApiKey && (
          <div className="flex max-w-[520px] flex-col gap-1.5">
            <label
              htmlFor="api-key-input"
              className="text-[12px] font-medium leading-[18px] text-[#CBD5E1]"
            >
              API Key
            </label>

            <div className="relative">
              <KeyIcon
                className="
                  pointer-events-none
                  absolute left-3 top-1/2
                  h-4 w-4
                  -translate-y-1/2
                  text-[#64748B]
                "
              />

              <input
                id="api-key-input"
                type="password"
                value={apiKey}
                onChange={(event) =>
                  setApiKey(event.target.value)
                }
                placeholder="Enter API key"
                className="
                  h-10 w-full
                  rounded-[6px]
                  border border-[#262D3D]
                  bg-[#0C0E14]
                  pl-9 pr-3
                  text-[14px] text-[#F1F5F9]
                  outline-none
                  placeholder:text-[#64748B]
                  transition-colors
                  hover:border-[#384258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/20
                "
              />
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div
            className="
              flex items-start gap-2
              rounded-[7px]
              border border-[#EF4444]/30
              bg-[#EF4444]/[0.08]
              p-3
              text-[13px]
              leading-[19px]
              text-[#FCA5A5]
            "
          >
            <XCircleIcon className="mt-0.5 h-[17px] w-[17px] flex-shrink-0" />

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
              flex flex-col gap-3
              border-t border-[#1E2333]
              pt-5
            "
          >
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-[17px] w-[17px] text-[#4ADE80]" />

              <span className="text-[14px] font-medium leading-5 text-[#F1F5F9]">
                Select Workspace Models
              </span>

              <span className="text-[12px] text-[#64748B]">
                ({discoveredModels.length} available)
              </span>
            </div>

            {discoveredModels.length === 0 ? (
              <div
                className="
                  rounded-[7px]
                  border border-[#1E2333]
                  bg-[#0C0E14]
                  px-4 py-4
                  text-[13px]
                  text-[#94A3B8]
                "
              >
                No chat-capable models found.
              </div>
            ) : (
              <div
                className="
                  flex max-h-[280px]
                  flex-col gap-1
                  overflow-y-auto
                  rounded-[8px]
                  border border-[#1E2333]
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
                        flex cursor-pointer
                        items-start gap-3
                        rounded-[7px]
                        border
                        p-3
                        transition-colors
                        ${
                          selected
                            ? "border-[#6366F1]/50 bg-[#1A1D2E]"
                            : "border-transparent hover:bg-[#151824]"
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
                          h-4 w-4
                          flex-shrink-0
                          accent-[#6366F1]
                        "
                      />

                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium leading-5 text-[#F1F5F9]">
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
                inline-flex min-h-[38px]
                items-center justify-center
                gap-2
                rounded-[6px]
                border border-[#6366F1]
                bg-[#4F46E5]
                px-4
                text-[13px] font-medium
                text-white
                shadow-[0_0_12px_rgba(99,102,241,0.25)]
                transition-colors
                hover:border-[#4F46E5]
                hover:bg-[#4338CA]
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-[#6366F1]/30
                disabled:cursor-not-allowed
                disabled:opacity-50
                disabled:shadow-none
              "
            >
              <ServerIcon className="h-4 w-4" />

              {isConnecting
                ? "Connecting..."
                : "Connect & Discover Models"}
            </button>
          ) : (
            <button
              id="add-models-btn"
              type="button"
              onClick={handleSave}
              disabled={selectedIds.length === 0}
              className="
                inline-flex min-h-[38px]
                items-center justify-center
                rounded-[6px]
                border border-[#6366F1]
                bg-[#4F46E5]
                px-4
                text-[13px] font-medium
                text-white
                shadow-[0_0_12px_rgba(99,102,241,0.25)]
                transition-colors
                hover:border-[#4F46E5]
                hover:bg-[#4338CA]
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-[#6366F1]/30
                disabled:cursor-not-allowed
                disabled:opacity-50
                disabled:shadow-none
              "
            >
              Add {selectedIds.length} Model
              {selectedIds.length !== 1 ? "s" : ""} to Workspace
            </button>
          )}

          <button
            id="cancel-add-provider-btn"
            type="button"
            onClick={onCancel}
            className="
              inline-flex min-h-[38px]
              items-center justify-center
              rounded-[6px]
              border border-[#262D3D]
              bg-transparent
              px-4
              text-[13px] font-medium
              text-[#CBD5E1]
              transition-colors
              hover:border-[#384258]
              hover:bg-[#161B26]
              hover:text-[#F1F5F9]
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

/* -------------------------------------------------------------------------- */
/* Main Providers Settings                                                     */
/* -------------------------------------------------------------------------- */

export function ProvidersSettings() {
  const [providers, setProviders] =
    useState<ProviderSettings[]>([]);

  const [workspaceModels, setWorkspaceModels] =
    useState<WorkspaceModel[]>([]);

  const [showAddForm, setShowAddForm] =
    useState(false);

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
    },
    [workspaceModels],
  );

  const handleFormSaved = () => {
    setShowAddForm(false);

    /*
     * Refresh persisted settings after saving so the UI
     * remains driven by the extension-side source of truth.
     */
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        type: "getSettings",
      });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Configured Providers                                                */}
      {/* ------------------------------------------------------------------ */}

      <section>
        <div className="mb-4">
          <h2 className="m-0 text-[18px] font-semibold leading-6 text-[#F1F5F9]">
            Configured Providers
          </h2>

          <p className="mt-1 text-[13px] leading-[19px] text-[#94A3B8]">
            These providers are available in your
            workspace.
          </p>
        </div>

        {providers.length === 0 ? (
          <div
            id="empty-providers-state"
            className="
              flex flex-col items-start
              rounded-[10px]
              border border-dashed border-[#262D3D]
              bg-[#12151E]
              px-6 py-7
            "
          >
            <div
              className="
                mb-3 flex h-9 w-9
                items-center justify-center
                rounded-[7px]
                border border-[#283042]
                bg-[#181D2A]
              "
            >
              <ServerIcon className="h-4 w-4 text-[#818CF8]" />
            </div>

            <p className="m-0 text-[14px] font-medium leading-5 text-[#F1F5F9]">
              No AI providers configured.
            </p>

            <p className="mt-1 max-w-[520px] text-[13px] leading-[19px] text-[#64748B]">
              Add a provider below to connect an AI
              model to your workspace.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
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
              />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Add Provider                                                        */}
      {/* ------------------------------------------------------------------ */}

      {!showAddForm ? (
        <section>
          <button
            id="add-provider-btn"
            type="button"
            onClick={() => setShowAddForm(true)}
            className="
              inline-flex min-h-[38px]
              items-center justify-center
              gap-2
              rounded-[6px]
              border border-[#6366F1]
              bg-[#4F46E5]
              px-4
              text-[13px] font-medium
              text-white
              shadow-[0_0_12px_rgba(99,102,241,0.25)]
              transition-colors
              hover:border-[#4F46E5]
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
      ) : (
        <AddProviderForm
          onCancel={() => setShowAddForm(false)}
          onSaved={handleFormSaved}
          existingModels={workspaceModels}
        />
      )}
    </div>
  );
}