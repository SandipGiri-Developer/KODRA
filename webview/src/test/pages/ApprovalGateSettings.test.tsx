/**
 * Comprehensive test suite for ApprovalGateSettings and command policy management.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ApprovalGateSettings } from "../../pages/config/ApprovalGate";
import { ApprovalPolicy } from "../../pages/config/ApprovalGate/types";
import React from "react";

const mockPostMessage = vi.fn();
(window as any).vscode = { postMessage: mockPostMessage };

// Dispatches a mock policyList message from the extension to the webview window
const dispatchPolicyList = (policies: ApprovalPolicy[]) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "policyList", policies },
      })
    );
  });
};

const samplePolicies: ApprovalPolicy[] = [
  {
    id: "pol-1",
    schemaVersion: 1,
    scope: "global",
    ruleType: "exact",
    commandPattern: "npm test",
    decision: "allow",
    enabled: true,
    description: "Run test suite",
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
  },
  {
    id: "pol-2",
    schemaVersion: 1,
    scope: "workspace",
    workspaceId: "ws-123",
    ruleType: "pattern",
    commandPattern: "git *",
    decision: "allow",
    enabled: false,
    description: "Git commands in workspace",
    createdAt: "2026-10-21T10:00:00Z",
    updatedAt: "2026-10-21T10:00:00Z",
  },
];

describe("ApprovalGateSettings", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
  });

  it("requests policy/list on mount", () => {
    render(<ApprovalGateSettings />);
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "policy/list" });
  });

  it("renders empty state when no policies exist", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList([]);

    await waitFor(() => {
      expect(screen.getByText(/no command policies configured/i)).toBeDefined();
      expect(screen.getByTestId("empty-add-policy-btn")).toBeDefined();
    });
  });

  it("renders existing policies with correct badges and commands", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
      expect(screen.getByText("git *")).toBeDefined();
      expect(screen.getByText("Global")).toBeDefined();
      expect(screen.getByText("Workspace")).toBeDefined();
      expect(screen.getByText("Exact")).toBeDefined();
      expect(screen.getByText("Wildcard")).toBeDefined();
    });
  });

  it("filters policies by tab (All, Global, Workspace)", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
      expect(screen.getByText("git *")).toBeDefined();
    });

    // Switch to Global tab
    const globalTab = screen.getByRole("button", { name: /^global \(\d+\)/i });
    fireEvent.click(globalTab);

    expect(screen.getByText("npm test")).toBeDefined();
    expect(screen.queryByText("git *")).toBeNull();

    // Switch to Workspace tab
    const workspaceTab = screen.getByRole("button", { name: /^workspace \(\d+\)/i });
    fireEvent.click(workspaceTab);

    expect(screen.queryByText("npm test")).toBeNull();
    expect(screen.getByText("git *")).toBeDefined();
  });

  it("filters policies by search pattern query", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/search policies/i);
    fireEvent.change(searchInput, { target: { value: "git" } });

    expect(screen.queryByText("npm test")).toBeNull();
    expect(screen.getByText("git *")).toBeDefined();
  });

  it("validates command input when adding a policy", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    const addBtn = screen.getByTestId("add-policy-btn");
    fireEvent.click(addBtn);

    expect(screen.getByRole("heading", { name: "Add Command Policy" })).toBeDefined();

    const patternInput = screen.getByTestId("policy-command-input");
    const saveBtn = screen.getByTestId("submit-policy-btn");

    // Test rejection of compound command operators
    fireEvent.change(patternInput, { target: { value: "npm test && rm -rf /" } });
    fireEvent.click(saveBtn);
    expect(screen.getByText(/prohibited for safety/i)).toBeDefined();

    // Test rejection of unbalanced quotes
    fireEvent.change(patternInput, { target: { value: "git commit -m \"unfinished" } });
    fireEvent.click(saveBtn);
    expect(screen.getByText(/unbalanced quotes/i)).toBeDefined();

    // Test rejection of duplicate policy in the same scope
    fireEvent.change(patternInput, { target: { value: "npm test" } });
    fireEvent.click(saveBtn);
    expect(screen.getByText(/already exists in global scope/i)).toBeDefined();
  });

  it("adds a new Global policy successfully", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    const addBtn = screen.getByTestId("add-policy-btn");
    fireEvent.click(addBtn);

    const patternInput = screen.getByTestId("policy-command-input");
    fireEvent.change(patternInput, { target: { value: "cargo build" } });

    const saveBtn = screen.getByTestId("submit-policy-btn");
    fireEvent.click(saveBtn);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "policy/create",
        policy: expect.objectContaining({
          commandPattern: "cargo build",
          scope: "global",
          decision: "allow",
        }),
      })
    );
  });

  it("adds a new Workspace policy successfully", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    const addBtn = screen.getByTestId("add-policy-btn");
    fireEvent.click(addBtn);

    const patternInput = screen.getByTestId("policy-command-input");
    fireEvent.change(patternInput, { target: { value: "mvn clean install" } });

    // Select Workspace Allowance radio
    const workspaceRadio = screen.getByText("Workspace Allowance");
    fireEvent.click(workspaceRadio);

    const saveBtn = screen.getByTestId("submit-policy-btn");
    fireEvent.click(saveBtn);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "policy/create",
        policy: expect.objectContaining({
          commandPattern: "mvn clean install",
          scope: "workspace",
          decision: "allow",
        }),
      })
    );
  });

  it("edits an existing policy and posts policy/update", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const editBtn = screen.getByTestId("edit-policy-pol-1");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit Command Policy")).toBeDefined();

    // Change scope from Global to Workspace
    const workspaceRadio = screen.getByText("Workspace Allowance");
    fireEvent.click(workspaceRadio);

    const saveBtn = screen.getByTestId("submit-policy-btn");
    fireEvent.click(saveBtn);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "policy/update",
        id: "pol-1",
        updates: expect.objectContaining({
          scope: "workspace",
          commandPattern: "npm test",
        }),
      })
    );
  });

  it("cancels editing without saving changes", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const editBtn = screen.getByTestId("edit-policy-pol-1");
    fireEvent.click(editBtn);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText("Edit Command Policy")).toBeNull();
    expect(mockPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "policy/update" })
    );
  });

  it("deletes a policy with confirmation modal", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const deleteBtn = screen.getByTestId("delete-policy-pol-1");
    fireEvent.click(deleteBtn);

    // Modal should be open
    expect(screen.getByText("Delete Command Policy")).toBeDefined();
    expect(screen.getByText(/Are you sure you want to remove this pre-approved policy/i)).toBeDefined();

    const confirmDeleteBtn = screen.getByTestId("confirm-delete-policy-btn");
    fireEvent.click(confirmDeleteBtn);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "policy/delete",
      id: "pol-1",
    });
  });

  it("cancels deletion in confirmation modal", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const deleteBtn = screen.getByTestId("delete-policy-pol-1");
    fireEvent.click(deleteBtn);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText("Delete Command Policy")).toBeNull();
    expect(mockPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "policy/delete" })
    );
  });

  it("toggles enabled state and sends policy/enable", async () => {
    render(<ApprovalGateSettings />);
    dispatchPolicyList(samplePolicies);

    await waitFor(() => {
      expect(screen.getByText("npm test")).toBeDefined();
    });

    const checkbox = screen.getByLabelText("Enable policy for npm test");
    fireEvent.click(checkbox);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "policy/enable",
      id: "pol-1",
      enabled: false,
    });
  });
});
