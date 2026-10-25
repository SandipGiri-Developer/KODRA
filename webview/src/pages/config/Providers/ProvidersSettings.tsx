import React, { useState, useEffect, useCallback } from "react";
import { ServerIcon, PlusIcon } from "@heroicons/react/24/outline";
import { ProviderCard } from "./ProviderCard";
import { AddProviderForm } from "./AddProviderForm";
import { ProviderSettings, WorkspaceModel } from "./types";

export function ProvidersSettings() {
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [workspaceModels, setWorkspaceModels] = useState<WorkspaceModel[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
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

      const updatedModels = workspaceModels.filter(
        (model) => model.providerConfigId !== id,
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
        previous.filter((provider) => provider.id !== id),
      );

      setWorkspaceModels(updatedModels);

      if (editingProvider?.id === id) {
        setEditingProvider(null);
      }
    },
    [workspaceModels, editingProvider],
  );

  const handleEdit = useCallback((provider: ProviderSettings) => {
    setShowAddForm(false);
    setEditingProvider(provider);
  }, []);

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
            className="flex flex-col items-start rounded-[9px] border border-dashed border-[#282F40] bg-[#11141C] px-5 py-6"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[7px] border border-[#293144] bg-[#181D28]">
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
              className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[7px] border border-[#4F46E5] bg-[#4F46E5] px-3.5 text-[12px] font-medium text-white transition-all hover:bg-[#4338CA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/30"
            >
              <PlusIcon className="h-4 w-4" />
              Add AI Provider
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 overflow-visible">
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

      {!showAddForm && !editingProvider && providers.length > 0 && (
        <section>
          <button
            id="add-provider-btn"
            type="button"
            onClick={() => {
              setEditingProvider(null);
              setShowAddForm(true);
            }}
            className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[7px] border border-[#4F46E5] bg-[#4F46E5] px-3.5 text-[12px] font-medium text-white transition-all hover:bg-[#4338CA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/30"
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

export default ProvidersSettings;
