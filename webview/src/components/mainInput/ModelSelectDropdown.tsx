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
import { Anthropic, OpenAI, Gemini, Ollama } from "@lobehub/icons";
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

export function ModelSelectDropdown() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  
  // In the real system, config would be fetched, but we're mimicking it or reading from backend
  const [currentProvider, setCurrentProvider] = useState<string>("ollama");
  const [currentModel, setCurrentModel] = useState<string>("Select model");
  
  const [models, setModels] = useState<DiscoveredModel[]>([]);
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
    setCurrentModel(val);
    const selected = models.find((m) => m.id === val);
    if ((window as any).vscode) {
      if (selected) {
        (window as any).vscode.postMessage({ type: "setProvider", provider: selected.provider });
      }
      (window as any).vscode.postMessage({ type: "setModel", model: val });
    }
  };

  const handleDeleteModel = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setModels(prev => {
      const newModels = prev.filter(m => m.id !== modelId);
      if (currentModel === modelId && newModels.length > 0) {
        setCurrentModel(newModels[0].id);
        if ((window as any).vscode) {
          (window as any).vscode.postMessage({ type: "setModel", model: newModels[0].id });
          (window as any).vscode.postMessage({ type: "setProvider", provider: newModels[0].provider });
        }
      }
      
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({ type: "saveWorkspaceModels", models: newModels });
      }
      
      return newModels;
    });
  };

  const selectedWorkspaceModel = models.find(m => m.id === currentModel);
  const displayTitle = selectedWorkspaceModel ? selectedWorkspaceModel.displayName : currentModel;

  return (
    <Listbox value={currentModel} onChange={handleSelect}>
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
        className="w-64 bg-vsc-background border border-vsc-commandCenter-inactiveBorder rounded-md shadow-xl z-50 mb-1"
      >
        <div className="flex justify-between items-center px-3 py-2 border-b border-vsc-commandCenter-inactiveBorder">
          <span className="text-xs font-semibold">Workspace Models</span>
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

        {!isLoading && models.map((model, idx) => (
          <ListboxOption
            key={idx}
            value={model.id}
            className={`group cursor-pointer px-3 py-1.5 flex items-center gap-2 hover:bg-list-active hover:text-list-active-foreground ${currentModel === model.id ? "bg-list-active text-list-active-foreground" : ""}`}
          >
            <ProviderMiniIcon provider={model.provider} />
            <div className="flex-1 flex flex-col overflow-hidden">
              <span className="truncate text-xs">{model.displayName}</span>
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
              onClick={(e) => handleDeleteModel(e, model.id)}
              title="Remove from Workspace"
            >
              <TrashIcon className="h-3.5 w-3.5 text-red-400 hover:text-red-500" />
            </div>
          </ListboxOption>
        ))}
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
