import React, { useContext, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { Button, Input } from "../components";

interface AddModelFormProps {
  onDone: () => void;
}

const PROVIDERS = [
  { id: "ollama", name: "Ollama (Local)" },
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "gemini", name: "Google Gemini" }
];

export function AddModelForm({ onDone }: AddModelFormProps) {
  const [provider, setProvider] = useState<string>("openai");
  const [apiKey, setApiKey] = useState<string>("");

  const needsApiKey = provider !== "ollama";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(window as any).vscode) return;

    (window as any).vscode.postMessage({ type: "setProvider", provider });
    if (needsApiKey && apiKey) {
      (window as any).vscode.postMessage({ type: "setApiKey", provider, key: apiKey });
    }
    // Discover models after a short delay so config has time to save
    setTimeout(() => {
      (window as any).vscode.postMessage({ type: "discoverModels", provider });
    }, 500);
    onDone();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="mx-auto max-w-md p-6">
        <h1 className="mb-0 text-center text-2xl">Configure AI Provider</h1>

        <div className="my-8 flex flex-col gap-6">
          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-vsc-input-background text-vsc-input-foreground border border-vsc-input-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-vsc-focusBorder"
            >
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {needsApiKey && (
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <Input
                type="password"
                className="w-full"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${PROVIDERS.find(p => p.id === provider)?.name} API key`}
                required
              />
            </div>
          )}
        </div>

        <div className="mt-4 w-full">
          <Button type="submit" className="w-full">
            Connect
          </Button>
        </div>
      </div>
    </form>
  );
}

export default AddModelForm;
