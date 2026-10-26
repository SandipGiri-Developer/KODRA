import {
  Cog6ToothIcon,
  CubeIcon,
  PlusIcon,
  ChevronDownIcon,
  WrenchScrewdriverIcon,
  PhotoIcon,
  LightBulbIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Anthropic, OpenAI, Gemini, Ollama, Groq, DeepSeek, Nvidia } from "@lobehub/icons";
import React, { useState, useEffect, useContext, useRef } from "react";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../ui/Listbox";
import { Divider } from "../ui/Divider";
import { useAppSelector, useAppDispatch } from "../../redux/hooks";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { setShowDialog, setDialogMessage } from "../../redux/slices/uiSlice";
import { updateConfig } from "../../redux/slices/configSlice";
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
  const config = useAppSelector((state) => state.config?.config);
  
  // In the real system, config would be fetched, but we're mimicking it or reading from backend
  const [currentProvider, setCurrentProvider] = useState<string>("ollama");
  const [currentModel, setCurrentModel] = useState<string>("Select model");
  const [currentProviderConfigId, setCurrentProviderConfigId] = useState<string>("");
  
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModelDialog, setShowAddModelDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const selectedWorkspaceModel = models.find(m => 
    m.id === currentModel && 
    (currentProviderConfigId ? m.providerConfigId === currentProviderConfigId : true) &&
    (currentProvider ? m.provider === currentProvider : true)
  ) || models.find(m => m.id === currentModel && (currentProvider ? m.provider === currentProvider : true))
    || models.find(m => m.id === currentModel);

  const selectedKey = selectedWorkspaceModel ? getModelKey(selectedWorkspaceModel) : currentModel;
  const displayTitle = selectedWorkspaceModel ? selectedWorkspaceModel.displayName : currentModel;

  useEffect(() => {
    if (!selectedWorkspaceModel || !config) return;

    const currentChat = config.selectedModelByRole?.chat;
    if (
      currentChat?.model === selectedWorkspaceModel.id &&
      currentChat?.provider === selectedWorkspaceModel.provider &&
      (currentChat as any)?.capabilities?.vision === Boolean(selectedWorkspaceModel.capabilities?.vision) &&
      (currentChat as any)?.capabilities?.reasoning === Boolean(selectedWorkspaceModel.capabilities?.reasoning)
    ) {
      return;
    }

    dispatch(
      updateConfig({
        ...config,
        selectedModelByRole: {
          ...config.selectedModelByRole,
          chat: {
            title: selectedWorkspaceModel.displayName,
            provider: selectedWorkspaceModel.provider,
            model: selectedWorkspaceModel.id,
            capabilities: {
              uploadImage: Boolean(selectedWorkspaceModel.capabilities?.vision),
              tools: Boolean(selectedWorkspaceModel.capabilities?.toolCalling),
              toolCalling: Boolean(selectedWorkspaceModel.capabilities?.toolCalling),
              vision: Boolean(selectedWorkspaceModel.capabilities?.vision),
              reasoning: Boolean(selectedWorkspaceModel.capabilities?.reasoning),
            } as any,
            completionOptions: {
              reasoning: Boolean(selectedWorkspaceModel.capabilities?.reasoning),
            },
          } as any,
        },
      })
    );
  }, [selectedWorkspaceModel, config, dispatch]);

  const filteredModels = models.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (m.displayName && m.displayName.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.provider && m.provider.toLowerCase().includes(q))
    );
  });

  const handleSelect = (val: string) => {
    setSearchQuery("");
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
      <ListboxButton 
        onClick={handleOpenDropdown}
        className="border-none bg-transparent hover:bg-transparent shadow-none px-1 py-0 hover:brightness-125 flex items-center gap-1.5 cursor-pointer"
      >
        {selectedWorkspaceModel && (
          <ProviderMiniIcon provider={selectedWorkspaceModel.provider} />
        )}
        <span className="text-xs text-vsc-foreground">{displayTitle}</span>
        <ChevronDownIcon className="h-3 w-3 text-vsc-foreground" />
      </ListboxButton>
      <ListboxOptions
        anchor="top start"
        className="w-72 bg-vsc-background border border-vsc-commandCenter-inactiveBorder rounded-md shadow-xl z-50 mb-1 flex flex-col"
      >
        <div className="flex justify-between items-center px-3 py-2 border-b border-vsc-commandCenter-inactiveBorder">
          <span className="text-xs font-semibold">Workspace Models</span>
          {models.length > 0 && (
            <span className="text-[10px] text-gray-400">
              {searchQuery.trim() ? `${filteredModels.length} of ${models.length}` : `${models.length}`}
            </span>
          )}
        </div>

        {/* Search input bar */}
        <div className="p-2 border-b border-vsc-commandCenter-inactiveBorder bg-vsc-input-background/30">
          <div className="relative flex items-center">
            <MagnifyingGlassIcon className="h-3.5 w-3.5 absolute left-2 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              data-testid="model-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="Search models..."
              className="w-full bg-vsc-input-background text-vsc-foreground text-xs rounded pl-7 pr-6 py-1 border border-vsc-commandCenter-inactiveBorder focus:outline-none focus:border-vsc-focusBorder placeholder:text-gray-400"
            />
            {searchQuery && (
              <button
                type="button"
                data-testid="clear-model-search"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 p-0.5 text-gray-400 hover:text-vsc-foreground rounded cursor-pointer"
                title="Clear search"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="no-scrollbar max-h-[300px] overflow-y-auto">
        {isLoading && (
          <div className="px-3 py-2 text-xs text-gray-500 italic">Discovering models...</div>
        )}
        
        {!isLoading && error && (
          <div className="px-3 py-2 text-xs text-red-500">{error}</div>
        )}
        
        {!isLoading && !error && models.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-500 italic">No models found.</div>
        )}

        {!isLoading && !error && models.length > 0 && filteredModels.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-400 italic text-center">
            No models found matching "{searchQuery}"
          </div>
        )}

        {!isLoading && filteredModels.map((model, idx) => {
          const modelKey = getModelKey(model);
          const isSelected = selectedWorkspaceModel 
            ? getModelKey(selectedWorkspaceModel) === modelKey
            : (currentModel === model.id && currentProvider === model.provider);

          return (
            <ListboxOption
              key={`${model.providerConfigId || model.provider}_${model.id}_${idx}`}
              value={modelKey}
              className={`group cursor-pointer px-3 py-1.5 flex items-center gap-2 hover:bg-list-active hover:text-list-active-foreground ${isSelected ? "bg-list-active text-list-active-foreground" : ""}`}
            >
              <ProviderMiniIcon provider={model.provider} />
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{model.displayName}</span>
                  <span className="text-[10px] text-gray-400 capitalize">({model.provider})</span>
                </div>
                <div className="flex gap-1 mt-0.5">
                  {model.capabilities?.toolCalling && (
                    <WrenchScrewdriverIcon className="h-3 w-3 text-blue-400" title="Supports tool calling" />
                  )}
                  {model.capabilities?.vision && (
                    <PhotoIcon className="h-3 w-3 text-green-400" title="Supports vision" />
                  )}
                  {model.capabilities?.reasoning && (
                    <LightBulbIcon className="h-3 w-3 text-yellow-400" title="Advanced reasoning" />
                  )}
                </div>
              </div>
              <div 
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-vsc-editor-background rounded transition-opacity"
                onClick={(e) => handleDeleteModel(e, model)}
                title="Remove from Workspace"
              >
                <TrashIcon className="h-3.5 w-3.5 text-red-400 hover:text-red-500" />
              </div>
            </ListboxOption>
          );
        })}
        </div>
        
        <Divider className="my-1" />
        <ListboxOption 
          value="CONFIGURE_MODELS"
          className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-list-active hover:text-list-active-foreground"
        >
          <span className="text-xs text-vsc-foreground">Configure Models...</span>
        </ListboxOption>
      </ListboxOptions>
    </Listbox>
  );
}

