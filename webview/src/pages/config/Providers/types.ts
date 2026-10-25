import {
  DiscoveredModel,
  ProviderSettings,
  WorkspaceModel,
} from "../../../../../src/providers/types";

export type ProviderType =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "deepseek"
  | "nvidia";

export type DiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface ProviderCardProps {
  provider: ProviderSettings;
  models: WorkspaceModel[];
  onDelete: (id: string) => void;
  onEdit: (provider: ProviderSettings) => void;
}

export interface AddProviderFormProps {
  onCancel: () => void;
  onSaved: () => void;
  existingModels: WorkspaceModel[];
  editingProvider?: ProviderSettings | null;
}

export type { DiscoveredModel, ProviderSettings, WorkspaceModel };
