/**
 * Permission Manager for KODRA Agent.
 * 
 * Manages user approval lifecycles for sensitive or destructive tools
 * (e.g., terminal command execution, file modifications).
 * Supports 4-way approval decisions: allow_once, always_allow_global,
 * always_allow_workspace, deny, and cancel.
 */

import { ApprovalDecisionType, PermissionRequest } from './types';

export type ApprovalDecisionHandler = (
  request: PermissionRequest,
) => Promise<ApprovalDecisionType | boolean>;

export interface IPermissionManager {
  /** Request 4-way user approval decision for a tool invocation */
  requestDecision(request: PermissionRequest, signal?: AbortSignal): Promise<ApprovalDecisionType>;
  /** Request user approval for a tool invocation (backward compatible boolean) */
  requestPermission(request: PermissionRequest, signal?: AbortSignal): Promise<boolean>;
  /** Resolve a pending permission request with boolean or 4-way decision */
  resolveRequest(requestId: string, decision: boolean | ApprovalDecisionType): boolean;
  /** Set custom approval handler (e.g. UI bridge or test mock) */
  setApprovalHandler(handler: ApprovalDecisionHandler | null): void;
  /** Cancel all pending permission requests */
  cancelAll(): void;
  /** Check if there are active pending requests */
  hasPendingRequests(): boolean;
  /** Resolve the latest request with boolean or 4-way decision */
  resolveLatest(decision: boolean | ApprovalDecisionType): boolean;
  /** Check if permission manager auto-approves by default */
  isAutoApprove(): boolean;
}

export class PermissionManager implements IPermissionManager {
  private customHandler: ApprovalDecisionHandler | null = null;
  private readonly pendingRequests: Map<string, (decision: ApprovalDecisionType) => void> = new Map();

  constructor(private readonly defaultAutoApprove: boolean = false) {}

  public isAutoApprove(): boolean {
    return this.defaultAutoApprove;
  }

  setApprovalHandler(handler: ApprovalDecisionHandler | null): void {
    this.customHandler = handler;
  }

  async requestDecision(request: PermissionRequest, signal?: AbortSignal): Promise<ApprovalDecisionType> {
    if (this.defaultAutoApprove) {
      return 'allow_once';
    }

    if (signal?.aborted) {
      return 'cancel';
    }

    if (this.customHandler) {
      try {
        const res = await this.customHandler(request);
        if (typeof res === 'boolean') {
          return res ? 'allow_once' : 'deny';
        }
        return res;
      } catch {
        return 'deny';
      }
    }

    return new Promise<ApprovalDecisionType>((resolve) => {
      let abortHandler: (() => void) | undefined;
      const onResolve = (decision: ApprovalDecisionType) => {
        if (abortHandler && signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        resolve(decision);
      };

      if (signal) {
        abortHandler = () => {
          this.pendingRequests.delete(request.requestId);
          resolve('cancel');
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pendingRequests.set(request.requestId, onResolve);
    });
  }

  async requestPermission(request: PermissionRequest, signal?: AbortSignal): Promise<boolean> {
    const decision = await this.requestDecision(request, signal);
    return decision === 'allow_once' || decision === 'always_allow_global' || decision === 'always_allow_workspace';
  }

  resolveRequest(requestId: string, decision: boolean | ApprovalDecisionType): boolean {
    const resolve = this.pendingRequests.get(requestId);
    if (resolve) {
      this.pendingRequests.delete(requestId);
      const normalized: ApprovalDecisionType =
        typeof decision === 'boolean' ? (decision ? 'allow_once' : 'deny') : decision;
      resolve(normalized);
      return true;
    }
    return false;
  }

  resolveLatest(decision: boolean | ApprovalDecisionType): boolean {
    const entries = Array.from(this.pendingRequests.entries());
    if (entries.length === 0) {
      return false;
    }
    const [latestId, resolve] = entries[entries.length - 1];
    this.pendingRequests.delete(latestId);
    const normalized: ApprovalDecisionType =
      typeof decision === 'boolean' ? (decision ? 'allow_once' : 'deny') : decision;
    resolve(normalized);
    return true;
  }

  cancelAll(): void {
    for (const [_, resolve] of this.pendingRequests) {
      resolve('cancel');
    }
    this.pendingRequests.clear();
  }

  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }
}
