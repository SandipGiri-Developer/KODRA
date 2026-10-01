/**
 * Generic Tool Registry for KODRA.
 * 
 * Provides a dynamic registry where tools can be added, inspected,
 * and retrieved without altering the core agent execution loop.
 */

import { ToolDefinition } from '../providers/types';
import { ITool } from './types';

export interface IToolRegistry {
  /** Register a new tool */
  register(tool: ITool): void;
  /** Unregister an existing tool by name */
  unregister(name: string): boolean;
  /** Retrieve a tool by name */
  getTool(name: string): ITool | undefined;
  /** Retrieve all registered tools */
  getAllTools(): ITool[];
  /** Generate model-compatible tool definitions dynamically */
  getToolDefinitions(): ToolDefinition[];
  /** Check if a tool is registered */
  hasTool(name: string): boolean;
  /** Remove all tools from the registry */
  clear(): void;
}

export class ToolRegistry implements IToolRegistry {
  private readonly tools: Map<string, ITool> = new Map();

  constructor(initialTools?: ITool[]) {
    if (initialTools) {
      for (const tool of initialTools) {
        this.register(tool);
      }
    }
  }

  register(tool: ITool): void {
    if (!tool || !tool.name) {
      throw new Error('Cannot register an invalid tool: name is required');
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.getDefinition());
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  clear(): void {
    this.tools.clear();
  }
}
