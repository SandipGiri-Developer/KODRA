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
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';

export interface BuildMessagesOptions {
  contextFiles?: string[];
  customInstructions?: string;
  indexer?: CodebaseIndexer;
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
  constructor(private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService()) {}

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
      'CRITICAL INSTRUCTION FOR AUTONOMOUS PROJECT UNDERSTANDING:',
      'When the user asks questions about the current project or repository (for example:',
      '  - "tell me something about the project"',
      '  - "what files are in this project?"',
      '  - "find where the main application starts"',
      '  - "explain how this project is structured"',
      '  - "read the package/configuration file and summarize it"',
      '  or any other repository-level questions):',
      '1. NEVER state that you lack information about the project or ask the user to explain it manually.',
      '2. You MUST autonomously inspect the workspace using your registered tools!',
      '3. Use `list_directory` to explore the project structure and discover files in the root or subfolders.',
      '4. Use `read_file` to read relevant project files such as package.json, README, configuration, or entry point files.',
      '5. Use `search_code` to locate key functions, exports, or startup logic.',
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
      ...conversationHistory,
    ];

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
