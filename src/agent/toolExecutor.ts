/**
 * Tool Executor for KODRA.
 * 
 * Modular component responsible for validating, checking permissions,
 * and executing tool invocations requested by the model.
 * Emits lifecycle events via AgentEventBus.
 */

import { ToolCall } from '../providers/types';
import { toError } from '../utils/errors';
import { IAgentEventBus } from './agentEventBus';
import { IPermissionManager } from './permissionManager';
import { IToolRegistry } from './toolRegistry';
import { PermissionRequest, ToolResult } from './types';

export interface ToolExecutionResponse {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  durationMs: number;
}

export interface IToolExecutor {
  executeToolCall(
    toolCall: ToolCall,
    executionId: string,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResponse>;
}

export class ToolExecutor implements IToolExecutor {
  constructor(
    private readonly toolRegistry: IToolRegistry,
    private readonly permissionManager: IPermissionManager,
    private readonly eventBus: IAgentEventBus,
  ) {}

  async executeToolCall(
    toolCall: ToolCall,
    executionId: string,
    signal?: AbortSignal,
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

    // 3. Permission / Approval handling
    if (tool.requiresApproval) {
      const permReq: PermissionRequest = {
        requestId: `req_${Date.now()}_${callId}`,
        executionId,
        toolCallId: callId,
        toolName: tool.name,
        description: `Requesting user permission to execute tool "${tool.name}"`,
        command: typeof parsedArgs.command === 'string' ? parsedArgs.command : undefined,
        filepath:
          typeof parsedArgs.file === 'string'
            ? parsedArgs.file
            : typeof parsedArgs.filePath === 'string'
            ? parsedArgs.filePath
            : undefined,
      };

      this.eventBus.emit({
        type: 'tool.approval_required',
        executionId,
        toolCallId: callId,
        toolName: tool.name,
        description: permReq.description,
        command: permReq.command,
        filepath: permReq.filepath,
        timestamp: Date.now(),
      });

      const approved = await this.permissionManager.requestPermission(permReq);

      if (signal?.aborted) {
        return {
          toolCallId: callId,
          toolName: tool.name,
          result: { content: 'Execution cancelled by user.', success: false },
          durationMs: 0,
        };
      }

      if (!approved) {
        this.eventBus.emit({
          type: 'tool.rejected',
          executionId,
          toolCallId: callId,
          toolName: tool.name,
          reason: 'User denied permission to execute tool',
          timestamp: Date.now(),
        });

        const rejectionResult: ToolResult = {
          content: `User denied permission to execute tool "${tool.name}".`,
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
        executionId,
        toolCallId: callId,
        toolName: tool.name,
        timestamp: Date.now(),
      });
    }

    // 4. Execute tool
    this.eventBus.emit({
      type: 'tool.started',
      executionId,
      toolCallId: callId,
      toolName: tool.name,
      timestamp: Date.now(),
    });

    const t0 = Date.now();
    let result: ToolResult;
    try {
      result = await tool.execute(parsedArgs, signal);
    } catch (execErr: unknown) {
      const err = toError(execErr);
      result = {
        content: `Tool execution failed: ${err.message}`,
        success: false,
      };
    }
    const durationMs = Date.now() - t0;

    if (result.success) {
      this.eventBus.emit({
        type: 'tool.completed',
        executionId,
        toolCallId: callId,
        toolName: tool.name,
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
