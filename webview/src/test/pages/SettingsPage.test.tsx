/**
 * SettingsPage tests.
 *
 * Covers:
 * - Renders sidebar with correct tabs
 * - AI Providers tab is selected by default
 * - Back to Chat button is present and fires navigate
 * - Settings data loaded via IPC
 * - Supports extensibility (nav items are buttons in a nav)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SettingsPage from "../../pages/config/SettingsPage";
import React from "react";

const mockPostMessage = vi.fn();
(window as any).vscode = { postMessage: mockPostMessage };

// Track navigate calls
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("SettingsPage", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
    navigateMock.mockClear();
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/config"]}>
        <Routes>
          <Route path="/config" element={<SettingsPage />} />
          <Route path="/" element={<div>Chat Home</div>} />
        </Routes>
      </MemoryRouter>
    );

  it("renders the Settings sidebar", () => {
    renderPage();
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("renders AI Providers nav item", () => {
    renderPage();
    expect(screen.getAllByText("AI Providers").length).toBeGreaterThan(0);
  });

  it("AI Providers is active by default", () => {
    renderPage();
    // The heading inside the main content should be 'AI Providers'
    expect(screen.getByRole("heading", { name: "AI Providers" })).toBeDefined();
  });

  it("renders a Back to Chat button", () => {
    renderPage();
    expect(screen.getByTitle("Back to Chat")).toBeDefined();
  });

  it("calls navigate('/') when Back to Chat is clicked", () => {
    renderPage();
    const backBtn = screen.getByTitle("Back to Chat");
    fireEvent.click(backBtn);
    expect(navigateMock).toHaveBeenCalledWith("/");
  });

  it("loads provider data on mount via IPC", async () => {
    renderPage();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "settingsData",
            providers: [{ id: "p1", name: "Test Ollama", provider: "ollama", endpoint: "" }],
            workspaceModels: [],
          },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Test Ollama")).toBeDefined();
    });
  });

  it("has a nav role element with category items", () => {
    renderPage();
    const nav = screen.getByRole("navigation");
    expect(nav).toBeDefined();
    expect(nav.textContent?.includes("AI Providers")).toBe(true);
  });

  it("requests settings from extension on mount", () => {
    renderPage();
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "getSettings" });
  });
});
