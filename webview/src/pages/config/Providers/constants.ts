import { ProviderType } from "./types";

export const PROVIDER_DISPLAY: Record<
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

export const PROVIDER_OPTIONS: {
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

export const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  nvidia: "https://integrate.api.nvidia.com/v1",
};
