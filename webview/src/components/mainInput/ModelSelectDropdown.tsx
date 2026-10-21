import {
  Cog6ToothIcon,
  CubeIcon,
  PlusIcon,
  ChevronDownIcon,
  WrenchScrewdriverIcon,
  PhotoIcon,
  LightBulbIcon,
  TrashIcon
} from "@heroicons/react/24/outline";
import { Anthropic, OpenAI, Gemini, Ollama, Groq, DeepSeek, Nvidia } from "@lobehub/icons";
import React, { useState, useEffect, useContext } from "react";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../ui/Listbox";
import { Divider } from "../ui/Divider";
import { useAppSelector, useAppDispatch } from "../../redux/hooks";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { setShowDialog, setDialogMessage } from "../../redux/slices/uiSlice";
import { AddModelForm } from "../../forms/AddModelForm";
import { TextDialog } from "../dialogs/TextDialog";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { DiscoveredModel } from "../../../../src/providers/types";

function ProviderMiniIcon({ provider, className = "h-3.5 w-3.5 flex-shrink-0" }: { provider?: string; className?: string }) {
  const p = (provider || "").toLowerCase();
  if (p.includes("ollama")) return <Ollama size={14} className={className} />;
  if (p.includes("openai")) return <OpenAI size={14} className={`text-[#10A37F] ${className}`} />;
  if (p.includes("anthropic") || p.includes("claude")) return <Anthropic size={14} className={`text-[#D4A373] ${className}`} />;
  if (p.includes("gemini") || p.includes("google")) return <Gemini.Color size={14} className={className} />;
  if (p.includes("groq")) return <Groq size={14} className={`text-[#F55036] ${className}`} />;
  if (p.includes("deepseek")) return <DeepSeek.Color size={14} className={className} />;
  if (p.includes("nvidia")) return <Nvidia.Color size={14} className={className} />;
  return <CubeIcon className={className} />;
}

interface WorkspaceModel {
  id: string;
  displayName: string;
  providerConfigId: string;
  provider: string;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    reasoning?: boolean;
  };
}

const getModelKey = (m: { id: string; provider?: string; providerConfigId?: string }) =>
  `${m.providerConfigId || m.provider || ''}:::${m.id}`;

export function ModelSelectDropdown() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();

  // In the real system, config would be fetched, but we're mimicking it or reading from backend
  const [currentProvider, setCurrentProvider] = useState<string>("ollama");
  const [currentModel, setCurrentModel] = useState<string>("Select model");
  const [currentProviderConfigId, setCurrentProviderConfigId] = useState<string>("");

  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModelDialog, setShowAddModelDialog] = useState(false);

  // Listen for models discovered and config updates directly since IdeMessenger wraps them differently
  useEffect(() => {
    // Request initial settings and config immediately on mount
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({ type: "getSettings" });
      (window as any).vscode.postMessage({ type: "getConfig" });
    }

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'config') {
        if (data.provider) setCurrentProvider(data.provider);
        if (data.model) setCurrentModel(data.model);
        if (data.providerConfigId) setCurrentProviderConfigId(data.providerConfigId);
      } else if (data.type === 'settingsData') {
        if (Array.isArray(data.workspaceModels)) {
          setModels(data.workspaceModels);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleOpenDropdown = () => {
    // Fetch latest settings whenever dropdown is opened
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({ type: "getSettings" });
    }
  };

  const selectedWorkspaceModel = models.find(m =>
    m.id === currentModel &&
    (currentProviderConfigId ? m.providerConfigId === currentProviderConfigId : true) &&
    (currentProvider ? m.provider === currentProvider : true)
  ) || models.find(m => m.id === currentModel && (currentProvider ? m.provider === currentProvider : true))
    || models.find(m => m.id === currentModel);

  const selectedKey = selectedWorkspaceModel ? getModelKey(selectedWorkspaceModel) : currentModel;
  const displayTitle = selectedWorkspaceModel ? selectedWorkspaceModel.displayName : currentModel;

  const handleSelect = (val: string) => {
    if (val === "CONFIGURE_MODELS") {
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: "executeCommand",
          command: "KODRA.openSettings",
        });
      }
      return;
    }

    const selected = models.find((m) => getModelKey(m) === val) || models.find((m) => m.id === val);
    if (selected) {
      setCurrentModel(selected.id);
      setCurrentProvider(selected.provider);
      if (selected.providerConfigId) {
        setCurrentProviderConfigId(selected.providerConfigId);
      }
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: "setProvider",
          provider: selected.provider,
          ...(selected.providerConfigId ? { providerConfigId: selected.providerConfigId } : {})
        });
        (window as any).vscode.postMessage({ type: "setModel", model: selected.id });
      }
    } else {
      setCurrentModel(val);
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({ type: "setModel", model: val });
      }
    }
  };

  const handleDeleteModel = (e: React.MouseEvent, targetModel: WorkspaceModel) => {
    e.stopPropagation();
    e.preventDefault();
    const targetKey = getModelKey(targetModel);
    setModels(prev => {
      const newModels = prev.filter(m => getModelKey(m) !== targetKey);
      if (selectedWorkspaceModel && getModelKey(selectedWorkspaceModel) === targetKey && newModels.length > 0) {
        const next = newModels[0];
        setCurrentModel(next.id);
        setCurrentProvider(next.provider);
        setCurrentProviderConfigId(next.providerConfigId || "");
        if ((window as any).vscode) {
          (window as any).vscode.postMessage({
            type: "setProvider",
            provider: next.provider,
            ...(next.providerConfigId ? { providerConfigId: next.providerConfigId } : {})
          });
          (window as any).vscode.postMessage({ type: "setModel", model: next.id });
        }
      }

      if ((window as any).vscode) {
        (window as any).vscode.postMessage({ type: "saveWorkspaceModels", models: newModels });
      }

      return newModels;
    });
  };

  return (
    <Listbox value={selectedKey} onChange={handleSelect}>
      <div className="inline-flex w-fit shrink-0">
        {/* Trigger */}
        <ListboxButton
          onClick={handleOpenDropdown}
          className="
            group inline-flex w-fit shrink-0 items-center gap-1.5
            rounded-lg border-none bg-transparent px-2 py-1
            text-vsc-foreground shadow-none outline-none cursor-pointer
            transition-colors duration-200 ease-out
            hover:bg-white/10 data-[open]:bg-white/10
          "
        >
          {selectedWorkspaceModel && (
            <ProviderMiniIcon provider={selectedWorkspaceModel.provider} />
          )}
          <span className="whitespace-nowrap text-xs font-medium">
            {displayTitle}
          </span>
          <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-70 transition-transform duration-200 group-data-[open]:rotate-180" />
        </ListboxButton>

        {/* Popover card (compact) */}
        <ListboxOptions
          anchor="top start"
          transition
          className="
            z-50 mb-1.5 w-56 overflow-hidden
            rounded-xl border border-white/10
            bg-vsc-background p-1
            shadow-xl shadow-black/40 outline-none origin-bottom-left
            transition duration-150 ease-out
            data-[closed]:scale-95 data-[closed]:opacity-0
          "
        >
          {/* Section label */}
          <div className="px-2 pb-1 pt-1">
            <span className="text-[11px] text-vsc-foreground opacity-50">
              Workspace Models
            </span>
          </div>

          {/* Thin divider */}
          <div className="mx-2 mb-1 h-px bg-white/10" />

          <div className="no-scrollbar max-h-[260px] overflow-y-auto">
            {isLoading && (
              <div className="px-2 py-1.5 text-xs italic text-vsc-foreground opacity-50">
                Discovering models...
              </div>
            )}

            {!isLoading && error && (
              <div className="px-2 py-1.5 text-xs text-red-500">{error}</div>
            )}

            {!isLoading && !error && models.length === 0 && (
              <div className="px-2 py-1.5 text-xs italic text-vsc-foreground opacity-50">
                No models found.
              </div>
            )}

            {!isLoading &&
              models.map((model, idx) => {
                const modelKey = getModelKey(model);
                const isSelected = selectedWorkspaceModel
                  ? getModelKey(selectedWorkspaceModel) === modelKey
                  : currentModel === model.id &&
                  currentProvider === model.provider;

                return (
                  <ListboxOption
                    key={`${model.providerConfigId || model.provider}_${model.id}_${idx}`}
                    value={modelKey}
                    className={`
                      group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5
                      text-vsc-foreground transition-all duration-150
                      data-[focus]:bg-white/5 data-[focus]:opacity-100
                      ${isSelected ? "opacity-100" : "opacity-60"}
                    `}
                  >
                    <ProviderMiniIcon provider={model.provider} />

                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {model.displayName}
                        </span>
                        <span className="shrink-0 text-[10px] capitalize opacity-50">
                          ({model.provider})
                        </span>
                      </div>

                      <div className="mt-0.5 flex gap-1">
                        {model.capabilities?.toolCalling && (
                          <WrenchScrewdriverIcon
                            className="h-3 w-3 text-blue-400"
                            title="Supports tool calling"
                          />
                        )}
                        {model.capabilities?.vision && (
                          <PhotoIcon
                            className="h-3 w-3 text-green-400"
                            title="Supports vision"
                          />
                        )}
                        {model.capabilities?.reasoning && (
                          <LightBulbIcon
                            className="h-3 w-3 text-yellow-400"
                            title="Advanced reasoning"
                          />
                        )}
                      </div>
                    </div>

                    {/* Delete button: appears on row hover */}
                    <div
                      className="rounded-md p-1 opacity-0 transition-all duration-150 hover:bg-white/10 group-hover:opacity-100"
                      onClick={(e) => handleDeleteModel(e, model)}
                      title="Remove from Workspace"
                    >
                      <TrashIcon className="h-3.5 w-3.5 text-red-400 hover:text-red-500" />
                    </div>
                  </ListboxOption>
                );
              })}
          </div>

          {/* Divider + configure row */}
          <div className="mx-2 my-1 h-px bg-white/10" />

          <ListboxOption
            value="CONFIGURE_MODELS"
            className="
              flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5
              text-vsc-foreground opacity-60 transition-all duration-150
              data-[focus]:bg-white/5 data-[focus]:opacity-100
            "
          >
            <span className="text-xs font-medium">Configure Models...</span>
          </ListboxOption>
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
