import React, { useState, useEffect } from "react";
import {
  ChevronDownIcon,
  ServerIcon,
  KeyIcon,
  PencilIcon,
  PlusIcon,
  EyeIcon,
  EyeSlashIcon,
  XCircleIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ProviderIcon } from "./ProviderIcon";
import { CapabilityChips } from "./CapabilityChips";
import {
  PROVIDER_DISPLAY,
  PROVIDER_OPTIONS,
  DEFAULT_ENDPOINTS,
} from "./constants";
import {
  AddProviderFormProps,
  DiscoveryStatus,
  ProviderType,
  DiscoveredModel,
  ProviderSettings,
  WorkspaceModel,
} from "./types";

export function AddProviderForm({
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

  return (
    <section
      className="
        rounded-[10px]
        border
        border-[#282F40]
        bg-[#11141C]
        p-6
        shadow-[0_8px_24px_rgba(0,0,0,0.35)]
      "
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
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

            <div className="relative flex-1">
              <select
                id="provider-type-select"
                value={providerType}
                disabled={isEditing}
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
                  text-[#F1F5F9]
                  outline-none
                  transition-colors
                  hover:border-[#394258]
                  focus:border-[#6366F1]
                  focus:ring-2
                  focus:ring-[#6366F1]/15
                  disabled:cursor-not-allowed
                  disabled:opacity-60
                "
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-[#0C0F15] text-[#F1F5F9]"
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="endpoint-input"
              className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#94A3B8]"
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
                "https://api.example.com"
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
        </div>

        {/* API Key */}
        {providerType !== "ollama" && (
          <div className="flex flex-col gap-1.5">
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

            <p className="mt-1.5 mb-1 text-[11.5px] leading-relaxed text-[#94A3B8]">
              <span className="font-medium text-[#A3ADC2]">Note:</span> Please select only the models that are accessible with your provided API key.
            </p>

            {/* Search Bar & Quick Select */}
            {discoveredModels.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="relative flex items-center">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 h-4 w-4 text-[#667085]" />
                  <input
                    type="text"
                    data-testid="provider-model-search"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search discovered models..."
                    className="
                      w-full
                      rounded-[7px]
                      border
                      border-[#1E2333]
                      bg-[#0C0E14]
                      py-2
                      pr-8
                      pl-9
                      text-[12px]
                      text-[#E5EAF1]
                      placeholder-[#5F6979]
                      transition-colors
                      focus:border-[#6366F1]
                      focus:outline-none
                    "
                  />
                  {modelSearchQuery && (
                    <button
                      type="button"
                      data-testid="clear-provider-model-search"
                      onClick={() => setModelSearchQuery("")}
                      className="absolute right-2.5 p-0.5 text-[#5F6979] hover:text-[#E5EAF1] rounded cursor-pointer"
                      title="Clear search"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#7D8798] px-0.5">
                  <span>
                    {modelSearchQuery.trim()
                      ? `Showing ${discoveredModels.filter((m) => {
                          const q = modelSearchQuery.toLowerCase().trim();
                          return (
                            (m.displayName && m.displayName.toLowerCase().includes(q)) ||
                            (m.id && m.id.toLowerCase().includes(q))
                          );
                        }).length} of ${discoveredModels.length} models (${selectedIds.length} selected)`
                      : `${discoveredModels.length} models found (${selectedIds.length} selected)`}
                  </span>
                  {discoveredModels.filter((m) => {
                    const q = modelSearchQuery.toLowerCase().trim();
                    return (
                      (m.displayName && m.displayName.toLowerCase().includes(q)) ||
                      (m.id && m.id.toLowerCase().includes(q))
                    );
                  }).length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const q = modelSearchQuery.toLowerCase().trim();
                          const matching = discoveredModels.filter((m) => {
                            if (!q) return true;
                            return (
                              (m.displayName && m.displayName.toLowerCase().includes(q)) ||
                              (m.id && m.id.toLowerCase().includes(q))
                            );
                          });
                          const idsToAdd = matching.map((m) => m.id);
                          setSelectedIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
                        }}
                        className="text-[#818CF8] hover:text-[#A5B4FC] cursor-pointer hover:underline"
                      >
                        Select all {modelSearchQuery.trim() ? "matching" : ""}
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          const q = modelSearchQuery.toLowerCase().trim();
                          const matching = discoveredModels.filter((m) => {
                            if (!q) return true;
                            return (
                              (m.displayName && m.displayName.toLowerCase().includes(q)) ||
                              (m.id && m.id.toLowerCase().includes(q))
                            );
                          });
                          const idsToRemove = new Set(matching.map((m) => m.id));
                          setSelectedIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
                        }}
                        className="text-[#7D8798] hover:text-[#94A3B8] cursor-pointer hover:underline"
                      >
                        Deselect all {modelSearchQuery.trim() ? "matching" : ""}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      rounded-[7px]
                      border
                      border-[#1E2333]
                      bg-[#0C0E14]
                      px-4
                      py-4
                      text-center
                      text-[12px]
                      text-[#7D8798]
                    "
                  >
                    No models found matching "{modelSearchQuery}"
                  </div>
                );
              }

              return (
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
                  {filtered.map((model) => {
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
              );
            })()}
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
