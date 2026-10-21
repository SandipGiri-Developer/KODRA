/**
 * Context Manager for KODRA.
 * 
 * Responsible for detecting the active VS Code workspace, active editor,
 * constructing comprehensive system instructions, formatting RAG chunks,
 * and building the message array for the Agent Runtime.
 */

import { CodebaseIndexer } from '../indexing/indexer';
import { SearchResult } from '../indexing/types';
import { ChatMessage } from '../providers/types';
import { IContextEngine } from './contextEngine';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';

export interface BuildMessagesOptions {
  contextFiles?: string[];
  customInstructions?: string;
  indexer?: CodebaseIndexer;
  contextEngine?: IContextEngine;
}

export interface IContextManager {
  buildSystemPrompt(options?: { customInstructions?: string }): string;
  buildMessages(
    userMessage: string,
    conversationHistory: ChatMessage[],
    options?: BuildMessagesOptions,
  ): Promise<ChatMessage[]>;
}

export class ContextManager implements IContextManager {
  constructor(
    private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
    private readonly contextEngine?: IContextEngine,
  ) {}

  buildSystemPrompt(options: { customInstructions?: string } = {}): string {
    const ws = this.workspaceService.getActiveWorkspaceFolder();
    const editorInfo = this.workspaceService.getActiveEditorInfo();

    let workspaceSection: string;
    if (ws) {
      workspaceSection = [
        'Active Workspace Context:',
        `- Project Name: ${ws.name}`,
        `- Workspace Root: ${ws.fsPath}`,
        editorInfo?.filePath ? `- Active Editor Document: ${editorInfo.filePath} (${editorInfo.language || 'text'})` : '',
      ].filter(Boolean).join('\n');
    } else {
      workspaceSection = 'Workspace Context: No workspace folder is currently open.';
    }

    const instructions = [
      'You are KODRA, an expert AI coding assistant integrated directly into VS Code.',
      '',
      workspaceSection,
      '',
      'Tools Available in this Workspace:',
      '- `list_directory`: Explore the directory structure and list files and folders. Essential for repository discovery.',
      '- `search_code`: Search for text, symbols, or regex patterns across the codebase to find definitions, usages, and entry points.',
      '- `read_file`: Inspect file contents with line numbers and optional line range slicing.',
      '- `create_file`: Create new files with full content in the workspace.',
      '- `edit_file`: Replace specific target text with new text in existing files.',
      '- `terminal`: Execute shell commands (e.g., tests, build, git). Requires explicit user permission.',
      '',
      'CRITICAL INSTRUCTION FOR AUTONOMOUS PROJECT UNDERSTANDING & EXPLORATION EFFICIENCY:',
      'When addressing repository-level questions, code analysis, or modification tasks:',
      '1. NEVER state that you lack information about the project or ask the user to explain it manually.',
      '2. Start with the available verified context and evidence provided in this prompt. If verified knowledge already provides the required information, synthesize the answer directly without redundant directory listing or re-reading unchanged files.',
      '3. When specific details, files, or symbols are missing or stale, perform targeted discovery using `search_code` or `read_file`.',
      '4. Avoid repeatedly listing directory structures when the contents are already known and unchanged.',
      '5. ALWAYS inspect the current source lines of a file with `read_file` before applying modifications with `edit_file`. Context memory is an optimization, not a replacement for verifying current source before code changes.',
      '6. Dynamically choose what information you need and synthesize a clear, helpful, accurate answer based directly on the actual repository.',
      '',
      'General Guidelines:',
      '- Be concise, precise, and practical.',
      '- Never modify files outside workspace boundaries.',
      '- Never read or modify secrets (.env, credentials, certificates).',
      options.customInstructions ? `\nCustom Instructions:\n${options.customInstructions}` : '',
    ].filter(Boolean).join('\n');

    return instructions;
  }

  async buildMessages(
    userMessage: string,
    conversationHistory: ChatMessage[],
    options: BuildMessagesOptions = {},
  ): Promise<ChatMessage[]> {
    const systemPrompt = this.buildSystemPrompt({
      customInstructions: options.customInstructions,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Gather verified context from ContextEngine if available
    const engine = options.contextEngine ?? this.contextEngine;
    if (engine) {
      try {
        const verifiedContext = await engine.getVerifiedContext(userMessage);
        if (verifiedContext && verifiedContext.trim().length > 0) {
          messages.push({
            role: 'system',
            content: verifiedContext,
          });
        }
      } catch {
        // Non-fatal
      }
    }

    // Include conversation history
    messages.push(...conversationHistory);

    // Gather codebase context via indexer if available
    if (options.indexer) {
      try {
        const results = await options.indexer.search(userMessage, 8);
        if (results && results.length > 0) {
          const contextText = this.formatSearchResults(results);
          if (contextText.trim().length > 0) {
            messages.push({
              role: 'system',
              content: `Relevant Codebase Context (from index):\n\n${contextText}`,
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Attach user-specified context files
    if (options.contextFiles && options.contextFiles.length > 0) {
      for (const filepath of options.contextFiles) {
        try {
          const content = await this.workspaceService.readFile(filepath);
          messages.push({
            role: 'system',
            content: `Attached File Context:\nFile: ${filepath}\n\n${content}`,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Ensure the current user message is at the end of the history
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }

  private formatSearchResults(results: SearchResult[]): string {
    const chunks: string[] = [];
    const seenFiles = new Set<string>();

    for (const result of results) {
      const fileKey = `${result.chunk.filepath}:${result.chunk.startLine}`;
      if (seenFiles.has(fileKey)) {
        continue;
      }
      seenFiles.add(fileKey);

      chunks.push(
        `--- ${result.chunk.filepath} (lines ${result.chunk.startLine + 1}-${result.chunk.endLine + 1}) ---\n` +
          result.chunk.content,
      );
    }

    return chunks.join('\n\n');
  }
}
