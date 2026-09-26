/**
 * ProvidersSettings comprehensive test suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ProvidersSettings } from "../../pages/config/ProvidersSettings";
import React from "react";

const mockPostMessage = vi.fn();
(window as any).vscode = { postMessage: mockPostMessage };

const dispatchSettings = (providers: unknown[], workspaceModels: unknown[] = []) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "settingsData", providers, workspaceModels },
      })
    );
  });
};

const dispatchModelsDiscovered = (models?: unknown[], error?: string) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "modelsDiscovered",
          provider: "ollama",
          models: models ?? [],
          error,
        },
      })
    );
  });
};

const renderComponent = () => render(<ProvidersSettings />);

const providerOllama = {
  id: "ollama-1",
  name: "My Ollama",
  provider: "ollama",
  endpoint: "http://localhost:11434",
};

const providerOpenAI = {
  id: "openai-1",
  name: "My OpenAI",
  provider: "openai",
  endpoint: "https://api.openai.com/v1",
  apiKeySecret: true,
};

const modelLlama: any = {
  id: "llama3",
  displayName: "Llama 3",
  provider: "ollama",
  providerConfigId: "ollama-1",
  capabilities: { toolCalling: true, vision: false, reasoning: false, streaming: true },
};

const modelQwen: any = {
  id: "qwen2.5",
  displayName: "Qwen 2.5",
  provider: "ollama",
  providerConfigId: "ollama-1",
  capabilities: { toolCalling: false, vision: false, reasoning: false, streaming: true },
};

// Helper: click the Add AI Provider button (not the h2 heading)
const clickAddProviderBtn = () =>
  fireEvent.click(screen.getByRole("button", { name: /Add AI Provider/i }));

describe("ProvidersSettings", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
  });

  it("shows empty state when no providers are configured", async () => {
    renderComponent();
    dispatchSettings([]);
    await waitFor(() => {
      expect(screen.getByText("No AI providers configured.")).toBeDefined();
    });
  });

  it("requests settings via IPC on mount", () => {
    renderComponent();
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "getSettings" });
  });

  it("does NOT show any provider on fresh install", async () => {
    renderComponent();
    dispatchSettings([]);
    await waitFor(() => {
      expect(screen.getByText("No AI providers configured.")).toBeDefined();
    });
  });

  it("shows a provider after successful configuration via IPC", async () => {
    renderComponent();
    dispatchSettings([providerOllama], [modelLlama]);
    await waitFor(() => {
      expect(screen.getByText("My Ollama")).toBeDefined();
    });
    expect(screen.getByText("Llama 3")).toBeDefined();
  });

  it("removes provider from UI and sends IPC on delete", async () => {
    renderComponent();
    dispatchSettings([providerOllama], []);
    await waitFor(() => expect(screen.getByText("My Ollama")).toBeDefined());

    // Open the overflow menu — it's the only button without an accessible name in the card
    // We query all buttons and find the EllipsisHorizontalIcon button via its SVG path content
    const allBtns = screen.getAllByRole("button");
    // Ellipsis button has no label, find by the 3-dots aria-hidden SVG child
    const ellipsisBtn = allBtns.find((b) =>
      b.innerHTML.includes("M6.75 12") // Part of EllipsisHorizontalIcon path
    );
    expect(ellipsisBtn).toBeDefined();
    fireEvent.click(ellipsisBtn!);

    const removeBtn = await screen.findByText("Remove");
    fireEvent.click(removeBtn);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "deleteProviderSetting", id: "ollama-1" })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "saveWorkspaceModels", models: [] })
    );
  });


  it("renders multiple configured providers", async () => {
    renderComponent();
    dispatchSettings([providerOllama, providerOpenAI], [modelLlama]);
    await waitFor(() => {
      expect(screen.getByText("My Ollama")).toBeDefined();
      expect(screen.getByText("My OpenAI")).toBeDefined();
    });
  });

  it("shows Add Provider form when button is clicked", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    expect(await screen.findByText("Connect & Discover Models")).toBeDefined();
  });

  it("sends discoverModels IPC message on Connect click", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    await screen.findByText("Connect & Discover Models");
    fireEvent.click(screen.getByText("Connect & Discover Models"));
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "discoverModels", provider: "ollama" })
    );
  });

  it("shows discovered models after successful discovery", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    await screen.findByText("Connect & Discover Models");
    fireEvent.click(screen.getByText("Connect & Discover Models"));
    dispatchModelsDiscovered([
      { id: "llama3", displayName: "Llama 3", capabilities: { toolCalling: true, vision: false, reasoning: false, streaming: true } },
      { id: "qwen2.5", displayName: "Qwen 2.5", capabilities: { toolCalling: false, vision: false, reasoning: false, streaming: true } },
    ]);
    await waitFor(() => {
      expect(screen.getByText("Llama 3")).toBeDefined();
      expect(screen.getByText("Qwen 2.5")).toBeDefined();
    });
  });

  it("saves selected models via IPC after discovery", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    await screen.findByText("Connect & Discover Models");
    fireEvent.click(screen.getByText("Connect & Discover Models"));
    dispatchModelsDiscovered([
      { id: "llama3", displayName: "Llama 3", capabilities: { toolCalling: true, vision: false, reasoning: false, streaming: true } },
    ]);
    await screen.findByText("Llama 3");
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const addBtn = await screen.findByText(/Add 1 Model/i);
    fireEvent.click(addBtn);
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "saveProviderSetting" })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "saveWorkspaceModels" })
    );
  });

  it("shows error message when discovery fails", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    await screen.findByText("Connect & Discover Models");
    fireEvent.click(screen.getByText("Connect & Discover Models"));
    dispatchModelsDiscovered(undefined, "Connection refused — Ollama not running");
    await waitFor(() => {
      expect(screen.getByText("Connection refused — Ollama not running")).toBeDefined();
    });
  });

  it("shows 'No chat-capable models found' when discovery returns empty list", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    await screen.findByText("Connect & Discover Models");
    fireEvent.click(screen.getByText("Connect & Discover Models"));
    dispatchModelsDiscovered([]);
    await waitFor(() => {
      expect(screen.getByText("No chat-capable models found.")).toBeDefined();
    });
  });

  it("hides form and returns to Add Provider button on cancel", async () => {
    renderComponent();
    dispatchSettings([]);
    clickAddProviderBtn();
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByText("Connect & Discover Models")).toBeNull();
    });
  });

  it("shows correct model count on provider card", async () => {
    renderComponent();
    dispatchSettings([providerOllama], [modelLlama, modelQwen]);
    await waitFor(() => {
      expect(screen.getByText("2 models selected")).toBeDefined();
    });
  });

  it("shows +N chip when more than 2 models are selected", async () => {
    const extraModel = { ...modelQwen, id: "phi3", displayName: "Phi-3" };
    renderComponent();
    dispatchSettings([providerOllama], [modelLlama, modelQwen, extraModel]);
    await waitFor(() => {
      expect(screen.getByText("+1")).toBeDefined();
    });
  });
});
