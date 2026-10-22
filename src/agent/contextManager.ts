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
  maxCombinedContextCharacters?: number;
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
      '- `find_symbol`: Locate any named symbol (class, function, interface, type, variable) across the workspace by name. Use this instead of scanning files manually when you know the symbol name.',
      '- `go_to_definition`: Navigate to the definition of a symbol given its file path and line/column. Use after `find_symbol` or `search_code` locates a usage and you need to find the declaration.',
      '- `find_references`: Find all usages of a symbol across the workspace given its file position. Use to understand the blast radius of a change before modifying shared code.',
      '- `git_context`: Read-only git operations — "log" (commit history), "blame" (line-by-line author attribution), "diff" (uncommitted changes), "status" (modified/staged files).',
      '',
      'CRITICAL INSTRUCTION FOR AUTONOMOUS PROJECT UNDERSTANDING & EXPLORATION EFFICIENCY:',
      'When addressing repository-level questions, code analysis, or modification tasks:',
      '1. NEVER state that you lack information about the project or ask the user to explain it manually.',
      '2. Start with the available verified context and evidence provided in this prompt. If verified knowledge already provides the required information, synthesize the answer directly without redundant directory listing or re-reading unchanged files.',
      '3. When specific details, files, or symbols are missing or stale, perform targeted discovery using `find_symbol`, `search_code`, or `read_file`.',
      '4. Distinguish clearly between search candidates, inspected excerpts, and verified findings. A search candidate is a target for inspection, not proof of behavior.',
      '5. When changing shared functions, interfaces, or exports, use `find_references` to discover all callers BEFORE applying changes, then inspect relevant callers and regression tests.',
      '6. Avoid repeatedly listing directory structures when the contents are already known and unchanged.',
      '7. ALWAYS inspect the current source lines of a file with `read_file` before applying modifications with `edit_file`. Context memory is an optimization, not a replacement for verifying current source before code changes.',
      '8. Dynamically choose what information you need and synthesize a clear, helpful, accurate answer based directly on the actual repository.',
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

    const maxBudget = options.maxCombinedContextCharacters ?? 8000;
    let remainingBudget = maxBudget;
    const attachedFileSet = new Set<string>();

    // 1. User-specified attached context files (highest priority context)
    const attachedMessages: ChatMessage[] = [];
    if (options.contextFiles && options.contextFiles.length > 0) {
      for (const filepath of options.contextFiles) {
        if (remainingBudget <= 200) {
          break;
        }
        try {
          const content = await this.workspaceService.readFile(filepath);
          const norm = filepath.replace(/\\/g, '/');
          attachedFileSet.add(norm);
          const maxFileChars = Math.min(content.length, remainingBudget - 100);
          const safeContent = content.length > maxFileChars ? content.slice(0, maxFileChars) + '\n[...truncated to context budget]' : content;
          const msgContent = `Attached File Context:\nFile: ${filepath}\n\n${safeContent}`;
          attachedMessages.push({
            role: 'system',
            content: msgContent,
          });
          remainingBudget -= msgContent.length;
        } catch {
          // Skip unreadable files
        }
      }
    }

    // 2. Gather verified context from ContextEngine if available
    const engine = options.contextEngine ?? this.contextEngine;
    if (engine && remainingBudget > 300) {
      try {
        const verifiedContext = await engine.getVerifiedContext(userMessage, {
          maxCharacters: Math.min(4000, remainingBudget),
        });
        if (verifiedContext && verifiedContext.trim().length > 0) {
          messages.push({
            role: 'system',
            content: verifiedContext,
          });
          remainingBudget -= verifiedContext.length;
        }
      } catch {
        // Non-fatal
      }
    }

    // Include conversation history
    messages.push(...conversationHistory);

    // 3. Gather codebase context via indexer if available (deduplicated against attached files)
    if (options.indexer && remainingBudget > 300) {
      try {
        const results = await options.indexer.search(userMessage, 8);
        if (results && results.length > 0) {
          // Filter out chunks from files that are already attached
          const filteredResults = results.filter((res) => {
            const normPath = res.chunk.filepath.replace(/\\/g, '/');
            return !attachedFileSet.has(normPath);
          });

          if (filteredResults.length > 0) {
            const contextText = this.formatSearchResults(filteredResults, remainingBudget - 100);
            if (contextText.trim().length > 0) {
              const fullMsg = `Relevant Codebase Context (from index):\n\n${contextText}`;
              messages.push({
                role: 'system',
                content: fullMsg,
              });
              remainingBudget -= fullMsg.length;
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Add attached file messages
    if (attachedMessages.length > 0) {
      messages.push(...attachedMessages);
    }

    // Ensure the current user message is at the end of the history
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }

  private formatSearchResults(results: SearchResult[], maxChars: number = 4000): string {
    const chunks: string[] = [];
    const seenFiles = new Set<string>();
    let totalLen = 0;

    for (const result of results) {
      const fileKey = `${result.chunk.filepath}:${result.chunk.startLine}`;
      if (seenFiles.has(fileKey)) {
        continue;
      }
      seenFiles.add(fileKey);

      const chunkStr =
        `--- ${result.chunk.filepath} (lines ${result.chunk.startLine + 1}-${result.chunk.endLine + 1}) ---\n` +
        result.chunk.content;

      if (totalLen + chunkStr.length > maxChars) {
        break;
      }
      chunks.push(chunkStr);
      totalLen += chunkStr.length;
    }

    return chunks.join('\n\n');
  }
}
