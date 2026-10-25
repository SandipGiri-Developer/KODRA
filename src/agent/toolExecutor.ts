/**
 * Tool Executor for KODRA.
 * 
 * Modular component responsible for validating, checking permissions,
 * and executing tool invocations requested by the model.
 * Emits lifecycle events via AgentEventBus.
 */

import { ToolCall } from '../providers/types';
import { toError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { IAgentEventBus } from './agentEventBus';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceRegistry } from '../storage/workspaceRegistry';
import { IPermissionManager } from './permissionManager';
import { IToolRegistry } from './toolRegistry';
import { PermissionRequest, ToolResult } from './types';

export interface ToolExecutionResponse {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  durationMs: number;
}

export interface TrustedExecutionContext {
  mode?: string;
  workspaceId?: string;
  cwd?: string;
}

export interface IToolExecutor {
  executeToolCall(
    toolCall: ToolCall,
    executionId: string,
    signal?: AbortSignal,
    context?: TrustedExecutionContext,
  ): Promise<ToolExecutionResponse>;
  setExecutionContext?(context: TrustedExecutionContext): void;
}

import { GateActionType, IApprovalGate } from './terminal/types';
import { ApprovalGate } from './terminal/approvalGate';
import { ApprovalPolicyService } from './terminal/approvalPolicyService';

export class ToolExecutor implements IToolExecutor {
  private executionContext: TrustedExecutionContext = {};
  private readonly approvalGate: IApprovalGate;

  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly permissionManager: IPermissionManager,
    private readonly eventBus: IAgentEventBus,
    approvalGate?: IApprovalGate,
    context?: TrustedExecutionContext,
  ) {
    this.approvalGate =
      approvalGate ??
      new ApprovalGate(
        ApprovalPolicyService.getInstance(),
        this.permissionManager,
        this.eventBus,
      );
    if (context) {
      this.executionContext = { ...context };
    }
  }

  public setExecutionContext(context: TrustedExecutionContext): void {
    this.executionContext = { ...this.executionContext, ...context };
  }

  async executeToolCall(
    toolCall: ToolCall,
    executionId: string,
    signal?: AbortSignal,
    context?: TrustedExecutionContext,
  ): Promise<ToolExecutionResponse> {
    const callId = toolCall.id || `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const toolName = toolCall.function.name;

    // 1. Parse JSON arguments
    let parsedArgs: Record<string, unknown> = {};
    if (typeof toolCall.function.arguments === 'object' && toolCall.function.arguments !== null) {
      parsedArgs = toolCall.function.arguments as Record<string, unknown>;
    } else {
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        const parseError = `Invalid JSON arguments for tool "${toolName}": ${toolCall.function.arguments}`;
        this.eventBus.emit({
          type: 'tool.failed',
          executionId,
          toolCallId: callId,
          toolName,
          error: parseError,
          durationMs: 0,
          timestamp: Date.now(),
        });
        return {
          toolCallId: callId,
          toolName,
          result: { content: parseError, success: false },
          durationMs: 0,
        };
      }
    }

    // Emit tool.requested
    this.eventBus.emit({
      type: 'tool.requested',
      executionId,
      toolCallId: callId,
      toolName,
      args: parsedArgs,
      timestamp: Date.now(),
    });

    // 2. Resolve tool from registry
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) {
      const unknownError = `Tool not found in registry: "${toolName}". Available tools: ${this.toolRegistry
        .getAllTools()
        .map((t) => t.name)
        .join(', ')}`;
      this.eventBus.emit({
        type: 'tool.failed',
        executionId,
        toolCallId: callId,
        toolName,
        error: unknownError,
        durationMs: 0,
        timestamp: Date.now(),
      });
      return {
        toolCallId: callId,
        toolName,
        result: { content: unknownError, success: false },
        durationMs: 0,
      };
    }

    let effectiveCwd: string | undefined;

    // Distinguish overall agent run ID from individual command execution ID
    const agentRunId = executionId;
    const isCommandTool =
      tool.capability === 'command_execution' ||
      tool.name === 'terminal' ||
      tool.name === 'run_command' ||
      tool.name === 'start_process';
    const isProcessInput = tool.capability === 'process_input' || tool.name === 'send_process_input';
    const isProcessManagement = tool.capability === 'process_management' || tool.name === 'stop_process';
    let commandExecutionId: string | undefined;
    if (isCommandTool) {
      if (typeof parsedArgs.executionId === 'string' && parsedArgs.executionId.trim()) {
        commandExecutionId = parsedArgs.executionId.trim();
      } else {
        commandExecutionId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
    }

    // 3. Permission / Approval handling
    const isTerminalReadOnlyAction =
      tool.name === 'terminal' &&
      typeof parsedArgs.action === 'string' &&
      ['status', 'wait', 'list_sessions'].includes(parsedArgs.action.trim());

    if (tool.requiresApproval && !isTerminalReadOnlyAction) {
      const command =
        typeof parsedArgs.command === 'string'
          ? parsedArgs.command
          : typeof parsedArgs.input === 'string'
          ? parsedArgs.input
          : undefined;
      const filepath =
        typeof parsedArgs.file === 'string'
          ? parsedArgs.file
          : typeof parsedArgs.filePath === 'string'
          ? parsedArgs.filePath
          : undefined;

      let description = `Requesting user permission to execute tool "${tool.name}"`;
      if (isProcessInput) {
        description = `Requesting user permission to send input to process "${parsedArgs.processId}": ${JSON.stringify(parsedArgs.input ?? '')}`;
      } else if (isProcessManagement) {
        description = `Requesting user permission to terminate process "${parsedArgs.processId}"${parsedArgs.force ? ' (force)' : ''}`;
      }

      const permReq: PermissionRequest = {
        requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        executionId: commandExecutionId || agentRunId,
        toolCallId: callId,
        toolName: tool.name,
        description,
        command,
        filepath,
      };

      let approved = false;
      let rejectionReason: string | undefined;

      // Trusted context derivation (never trust unverified model-supplied mode/workspaceId)
      let trustedWsId = context?.workspaceId || this.executionContext.workspaceId;
      if (!trustedWsId) {
        try {
          trustedWsId = WorkspaceRegistry.getWorkspaceInfo().id;
        } catch {
          trustedWsId = 'global';
        }
      }

      const trustedMode = (context?.mode || this.executionContext.mode || 'agent').toLowerCase();
      // Fail closed for missing or invalid security-sensitive mode context
      if (!['agent', 'chat', 'plan', 'goal'].includes(trustedMode)) {
        const modeError = `Invalid or missing execution mode "${trustedMode}". Autonomous execution halted.`;
        this.eventBus.emit({
          type: 'tool.failed',
          executionId: agentRunId,
          toolCallId: callId,
          toolName: tool.name,
          error: modeError,
          durationMs: 0,
          timestamp: Date.now(),
        });
        return {
          toolCallId: callId,
          toolName: tool.name,
          result: { content: modeError, success: false },
          durationMs: 0,
        };
      }

      if (trustedMode === 'plan' && (isCommandTool || isProcessInput || isProcessManagement)) {
        const planError = `Execution of "${tool.name}" is prohibited in Plan mode. Plan mode is restricted to read-only analysis.`;
        this.eventBus.emit({
          type: 'tool.failed',
          executionId: agentRunId,
          toolCallId: callId,
          toolName: tool.name,
          error: planError,
          durationMs: 0,
          timestamp: Date.now(),
        });
        return {
          toolCallId: callId,
          toolName: tool.name,
          result: { content: planError, success: false },
          durationMs: 0,
        };
      }

      if (trustedMode === 'chat' && (isCommandTool || isProcessInput || isProcessManagement)) {
        const chatError = `Autonomous execution of "${tool.name}" is not permitted in Chat mode. Switch to Agent mode.`;
        this.eventBus.emit({
          type: 'tool.failed',
          executionId: agentRunId,
          toolCallId: callId,
          toolName: tool.name,
          error: chatError,
          durationMs: 0,
          timestamp: Date.now(),
        });
        return {
          toolCallId: callId,
          toolName: tool.name,
          result: { content: chatError, success: false },
          durationMs: 0,
        };
      }

      // Working directory resolution and path containment check
      let trustedCwd = context?.cwd || this.executionContext.cwd;
      if (!trustedCwd) {
        try {
          trustedCwd = WorkspaceRegistry.getWorkspaceInfo().path;
        } catch {
          trustedCwd = process.cwd();
        }
      }

      if (typeof parsedArgs.cwd === 'string' && parsedArgs.cwd.trim()) {
        const candidate = path.resolve(trustedCwd || process.cwd(), parsedArgs.cwd.trim());
        if (!fs.existsSync(candidate)) {
          const cwdError = `Working directory does not exist: "${candidate}".`;
          this.eventBus.emit({
            type: 'tool.failed',
            executionId: agentRunId,
            toolCallId: callId,
            toolName: tool.name,
            error: cwdError,
            durationMs: 0,
            timestamp: Date.now(),
          });
          return {
            toolCallId: callId,
            toolName: tool.name,
            result: { content: cwdError, success: false },
            durationMs: 0,
          };
        }

        let realCandidate = candidate;
        try {
          realCandidate = fs.realpathSync(candidate);
        } catch {}

        const wsFolders = vscode.workspace?.workspaceFolders?.map((f: any) => f.uri?.fsPath || f.fsPath) || [trustedCwd];
        const isContained = wsFolders.some((root: string) => {
          let realRoot = root;
          try {
            if (fs.existsSync(root)) {
              realRoot = fs.realpathSync(root);
            }
          } catch {}

          const rel = path.relative(realRoot, realCandidate);
          return !rel.startsWith('..') && !path.isAbsolute(rel);
        });

        if (!isContained) {
          const cwdError = `Access denied: Working directory "${candidate}" is outside authorized workspace boundaries.`;
          this.eventBus.emit({
            type: 'tool.failed',
            executionId: agentRunId,
            toolCallId: callId,
            toolName: tool.name,
            error: cwdError,
            durationMs: 0,
            timestamp: Date.now(),
          });
          return {
            toolCallId: callId,
            toolName: tool.name,
            result: { content: cwdError, success: false },
            durationMs: 0,
          };
        }
        trustedCwd = candidate;
      }
      effectiveCwd = trustedCwd;

      const isTerminalChange =
        tool.name === 'terminal' &&
        typeof parsedArgs.action === 'string' &&
        ['cancel', 'close'].includes(parsedArgs.action.trim());
      const isProtectedProcessOrTerminal =
        isCommandTool || isProcessInput || isProcessManagement || isTerminalChange;

      if (isProtectedProcessOrTerminal) {
        if ('setEventBus' in this.approvalGate && typeof (this.approvalGate as any).setEventBus === 'function') {
          (this.approvalGate as any).setEventBus(this.eventBus);
        }

        let actionType: GateActionType = 'command';
        if (tool.name === 'start_process') {
          actionType = 'process_start';
        } else if (isProcessInput) {
          actionType = 'process_input';
        } else if (isProcessManagement) {
          actionType = 'process_stop';
        } else if (isTerminalChange) {
          actionType = 'terminal_change';
        } else {
          actionType = 'command';
        }

        const auth = await this.approvalGate.evaluateAndAuthorize(
          {
            actionType,
            command: typeof parsedArgs.command === 'string' ? parsedArgs.command : undefined,
            processId: typeof parsedArgs.processId === 'string' ? parsedArgs.processId : undefined,
            input: typeof parsedArgs.input === 'string' ? parsedArgs.input : undefined,
            cwd: trustedCwd,
            workspaceId: trustedWsId,
            mode: trustedMode,
            executionId: commandExecutionId,
            toolCallId: callId,
            description: permReq.description,
            toolName: tool.name,
          },
          signal,
        );
        approved = auth.authorized;
        if (!approved) {
          rejectionReason = auth.reason;
        }
      } else {
        this.eventBus.emit({
          type: 'tool.approval_required',
          executionId: agentRunId,
          toolCallId: callId,
          toolName: tool.name,
          description: permReq.description,
          command: permReq.command,
          filepath: permReq.filepath,
          requestId: permReq.requestId,
          timestamp: Date.now(),
        });

        approved = await this.permissionManager.requestPermission(permReq, signal);
      }

      if (signal?.aborted) {
        return {
          toolCallId: callId,
          toolName: tool.name,
          result: { content: 'Execution cancelled by user.', success: false },
          durationMs: 0,
        };
      }

      if (!approved) {
        const finalReason = rejectionReason || `User denied permission to execute tool "${tool.name}".`;
        this.eventBus.emit({
          type: 'tool.rejected',
          executionId: agentRunId,
          toolCallId: callId,
          toolName: tool.name,
          reason: finalReason,
          timestamp: Date.now(),
        });

        const rejectionResult: ToolResult = {
          content: finalReason,
          success: false,
        };

        return {
          toolCallId: callId,
          toolName: tool.name,
          result: rejectionResult,
          durationMs: 0,
        };
      }

      this.eventBus.emit({
        type: 'tool.approved',
        executionId: agentRunId,
        toolCallId: callId,
        toolName: tool.name,
        timestamp: Date.now(),
      });
    }

    // 4. Execute tool
    this.eventBus.emit({
      type: 'tool.started',
      executionId: agentRunId,
      toolCallId: callId,
      toolName: tool.name,
      args: { ...parsedArgs, executionId: commandExecutionId || agentRunId },
      timestamp: Date.now(),
    });

    Logger.getInstance().info(`[KODRA Lifecycle] Tool started tool=${tool.name} toolCallId=${callId} executionId=${agentRunId}`);

    const t0 = Date.now();
    let result: ToolResult;
    try {
      const execArgs: Record<string, unknown> = {
        ...parsedArgs,
        executionId: commandExecutionId || agentRunId,
        toolCallId: callId,
        agentRunId,
      };
      if (isCommandTool && effectiveCwd) {
        execArgs.cwd = effectiveCwd;
      }
      result = await tool.execute(execArgs, signal);
    } catch (execErr: unknown) {
      const err = toError(execErr);
      result = {
        content: `Tool execution failed: ${err.message}`,
        success: false,
      };
    }
    const durationMs = Date.now() - t0;
    Logger.getInstance().info(`[KODRA Lifecycle] Tool ${result.success ? 'completed' : 'failed'} tool=${tool.name} toolCallId=${callId} duration=${durationMs}ms executionId=${executionId}`);

    if (result.success) {
      this.eventBus.emit({
        type: 'tool.completed',
        executionId,
        toolCallId: callId,
        toolName: tool.name,
        args: parsedArgs,
        result,
        durationMs,
        timestamp: Date.now(),
      });
    } else {
      this.eventBus.emit({
        type: 'tool.failed',
        executionId,
        toolCallId: callId,
        toolName: tool.name,
        error: result.content,
        durationMs,
        timestamp: Date.now(),
      });
    }

    return {
      toolCallId: callId,
      toolName: tool.name,
      result,
      durationMs,
    };
  }
}
