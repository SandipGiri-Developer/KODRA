/**
 * Permission Manager for KODRA Agent.
 * 
 * Manages user approval lifecycles for sensitive or destructive tools
 * (e.g., terminal command execution, file modifications).
 */

import { PermissionRequest } from './types';

export type ApprovalHandler = (request: PermissionRequest) => Promise<boolean>;

export interface IPermissionManager {
  /** Request user approval for a tool invocation */
  requestPermission(request: PermissionRequest): Promise<boolean>;
  /** Resolve a pending permission request (e.g. from webview IPC) */
  resolveRequest(requestId: string, approved: boolean): boolean;
  /** Set custom approval handler (e.g. UI bridge or test mock) */
  setApprovalHandler(handler: ApprovalHandler | null): void;
  /** Cancel all pending permission requests */
  cancelAll(): void;
  /** Check if there are active pending requests */
  hasPendingRequests(): boolean;
}

export class PermissionManager implements IPermissionManager {
  private customHandler: ApprovalHandler | null = null;
  private readonly pendingRequests: Map<string, (approved: boolean) => void> = new Map();

  constructor(private readonly defaultAutoApprove: boolean = false) {}

  setApprovalHandler(handler: ApprovalHandler | null): void {
    this.customHandler = handler;
  }

  async requestPermission(request: PermissionRequest): Promise<boolean> {
    // If auto-approve is explicitly enabled (e.g. in headless tests), approve immediately
    if (this.defaultAutoApprove) {
      return true;
    }

    // If an external approval handler is provided, delegate to it
    if (this.customHandler) {
      try {
        return await this.customHandler(request);
      } catch {
        return false;
      }
    }

    // Default: Wait for explicit resolution via resolveRequest(requestId, approved)
    return new Promise<boolean>((resolve) => {
      this.pendingRequests.set(request.requestId, resolve);
    });
  }

  resolveRequest(requestId: string, approved: boolean): boolean {
    const resolve = this.pendingRequests.get(requestId);
    if (resolve) {
      this.pendingRequests.delete(requestId);
      resolve(approved);
      return true;
    }
    return false;
  }

  /**
   * Helper to resolve the most recent or single pending request.
   * Useful when UI does not track request IDs.
   */
  resolveLatest(approved: boolean): boolean {
    const entries = Array.from(this.pendingRequests.entries());
    if (entries.length === 0) {
      return false;
    }
    const [latestId, resolve] = entries[entries.length - 1];
    this.pendingRequests.delete(latestId);
    resolve(approved);
    return true;
  }

  cancelAll(): void {
    for (const [id, resolve] of this.pendingRequests) {
      resolve(false);
    }
    this.pendingRequests.clear();
  }

  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }
}
