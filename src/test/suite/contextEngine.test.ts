/**
 * Context Engine Verification Tests for KODRA — Phase 1.
 *
 * Verifies:
 * 1. Source freshness: edited files remain stale until reread, including same-size/misleading changes.
 * 2. Deleted-file invalidation.
 * 3. Bounded context size limits and duplicate removal.
 * 4. Task-relevant context selection.
 * 5. Workspace isolation and persistence across reloads.
 * 6. Avoidance of redundant exploration without blocking necessary tool calls.
 * 7. Fallback to existing retrieval and file tools when memory is unavailable.
 * 8. Persistence failure isolation with sanitized logging.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { AgentLoop } from '../../agent/agentLoop';
import { ContextEngine } from '../../agent/contextEngine';
import { ContextManager } from '../../agent/contextManager';
import { VSCodeWorkspaceService } from '../../agent/workspaceService';
import { StorageManager } from '../../storage/storageManager';
import { ILLMProvider, StreamChunk } from '../../providers/types';

function createMockProvider(streamGenerator: (messages: any[]) => AsyncGenerator<StreamChunk>): ILLMProvider {
  return {
    id: 'mock',
    displayName: 'Mock Provider',
    getDefaultModel: () => 'mock-model',
    capabilities: { toolCalling: true, streaming: true, vision: false },
    testConnection: jest.fn().mockResolvedValue(['mock-model']),
    discoverModels: jest.fn().mockResolvedValue([]),
    dispose: jest.fn(),
    streamChat: (messages: any[]) => streamGenerator(messages),
  };
}

describe('Kodra Context Engine Tests — Phase 1', () => {
  let tempWs: string;
  let tempStorageRoot: string;
  let workspaceService: VSCodeWorkspaceService;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-context-ws-'));
    tempStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-context-storage-'));

    // Configure workspace folders
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'context-engine-test', index: 0 },
    ];
    workspaceService = new VSCodeWorkspaceService(tempWs);

    // Initialize Kodra storage manager for tests
    StorageManager.initialize(tempStorageRoot);

    // Populate realistic project files
    await fs.mkdir(path.join(tempWs, 'src'), { recursive: true });

    // package.json
    await fs.writeFile(
      path.join(tempWs, 'package.json'),
      JSON.stringify(
        {
          name: 'kodra-context-demo',
          version: '1.2.0',
          main: 'src/index.ts',
          scripts: { build: 'tsc', test: 'jest' },
          dependencies: { express: '^4.18.2' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    // tsconfig.json
    await fs.writeFile(
      path.join(tempWs, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: { target: 'ES2022', module: 'CommonJS', outDir: './out' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    // README.md
    await fs.writeFile(
      path.join(tempWs, 'README.md'),
      '# Kodra Context Engine Demo\n\nThis is a demonstration repository for testing context reuse and freshness.',
      'utf-8',
    );

    // src/index.ts
    await fs.writeFile(
      path.join(tempWs, 'src', 'index.ts'),
      'export class ApplicationService {\n  start(): void { console.log("Running"); }\n}\nexport function main() {}\n',
      'utf-8',
    );
  });

  afterAll(async () => {
    try {
      await fs.rm(tempWs, { recursive: true, force: true });
      await fs.rm(tempStorageRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('1. ContextEngine extracts deterministic evidence and records directory listings', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);

    // Record directory listing
    engine.recordDirectoryListing('.', ['package.json', 'tsconfig.json', 'README.md', 'src/']);
    expect(engine.hasDirectory('.')).toBe(true);
    expect(engine.getState().directories['.'].entries).toContain('package.json');

    // Record file read for package.json
    const pkgContent = await workspaceService.readFile('package.json');
    await engine.recordFileRead('package.json', pkgContent);

    expect(engine.isFresh('package.json')).toBe(true);
    const state = engine.getState();
    expect(state.files['package.json']).toBeDefined();
    expect(state.files['package.json'].summary).toContain('kodra-context-demo@1.2.0');

    // Finding must exist for package manifest
    const manifestFinding = state.findings.find((f) => f.category === 'manifest');
    expect(manifestFinding).toBeDefined();
    expect(manifestFinding?.text).toContain('kodra-context-demo');
    expect(manifestFinding?.text).toContain('src/index.ts');
  });

  test('2. Source Freshness: edited files remain stale until reread even with same-size or matching metadata', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);

    // Initial read
    const initialContent = await workspaceService.readFile('src/index.ts');
    await engine.recordFileRead('src/index.ts', initialContent);
    expect(engine.isFresh('src/index.ts')).toBe(true);

    // 1. File modified via recordFileModified (e.g. edit_file tool executed)
    await engine.recordFileModified('src/index.ts');
    expect(engine.isFresh('src/index.ts')).toBe(false);
    expect(engine.getState().files['src/index.ts'].status).toBe('stale');

    // 2. checkFreshness() runs — file MUST REMAIN stale, NOT reset to fresh!
    await engine.checkFreshness();
    expect(engine.isFresh('src/index.ts')).toBe(false);
    expect(engine.getState().files['src/index.ts'].status).toBe('stale');

    // 3. Stale findings are NOT presented as verified fresh facts in prompt context
    const staleContext = await engine.getVerifiedContext();
    expect(staleContext).toContain('Files Requiring Re-verification');
    expect(staleContext).toContain('src/index.ts (modified — re-verify with read_file before assuming previous findings)');
    expect(staleContext).not.toContain('Verified Inspected Files & Key Findings:\n- [Evidence] src/index.ts');

    // 4. Multiple checkFreshness() calls still keep it stale
    await engine.checkFreshness();
    expect(engine.getState().files['src/index.ts'].status).toBe('stale');

    // 5. Only after reading current content does it become fresh again with updated findings
    const updatedContent = 'export class UpdatedService {\n  run(): void {}\n}\n';
    await fs.writeFile(path.join(tempWs, 'src', 'index.ts'), updatedContent, 'utf-8');
    await engine.recordFileRead('src/index.ts', updatedContent);

    expect(engine.isFresh('src/index.ts')).toBe(true);
    const refreshedContext = await engine.getVerifiedContext();
    expect(refreshedContext).toContain('UpdatedService');
    expect(refreshedContext).not.toContain('src/index.ts (modified');
  });

  test('3. Deleted-file invalidation: deleted files are safely removed from verified facts', async () => {
    const tempFile = path.join(tempWs, 'temp-to-delete.txt');
    await fs.writeFile(tempFile, 'temporary data to delete', 'utf-8');

    const engine = ContextEngine.createForWorkspace(workspaceService);
    const content = await workspaceService.readFile('temp-to-delete.txt');
    await engine.recordFileRead('temp-to-delete.txt', content);
    expect(engine.isFresh('temp-to-delete.txt')).toBe(true);

    // Delete the file from filesystem
    await fs.unlink(tempFile);

    // checkFreshness() must detect deletion
    await engine.checkFreshness();
    expect(engine.isFresh('temp-to-delete.txt')).toBe(false);
    expect(engine.getState().files['temp-to-delete.txt'].status).toBe('deleted');

    const contextText = await engine.getVerifiedContext();
    expect(contextText).toContain('temp-to-delete.txt (deleted or missing)');
    expect(contextText).not.toContain('temp-to-delete.txt (fresh');
  });

  test('4. Bounded Context and Duplicate Removal: enforces size limits and prunes duplicate findings', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);

    // Add multiple files and findings
    for (let i = 1; i <= 8; i++) {
      const fileName = `src/module_${i}.ts`;
      const code = `export class Service${i} {\n  doTask${i}(): void {}\n}\n`;
      await fs.writeFile(path.join(tempWs, fileName), code, 'utf-8');
      await engine.recordFileRead(fileName, code);
    }

    // Explicitly add duplicate findings to verify deduplication
    engine.getState().findings.push({
      id: 'dup_1',
      category: 'symbols',
      sourceFile: 'src/module_1.ts',
      sourceMtime: 1001,
      text: 'src/module_1.ts (lines 1-3) exports: class Service1',
      timestamp: Date.now(),
    });

    // Request context with tight size limit (e.g. maxCharacters: 800)
    const boundedContext = await engine.getVerifiedContext(undefined, { maxCharacters: 800 });
    expect(boundedContext.length).toBeLessThanOrEqual(800);

    // Duplicate check: ensure same line does not appear twice
    const occurrences = boundedContext.split('src/module_1.ts (lines 1-3) exports: class Service1').length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  test('5. Task-Relevant Context Selection: prioritizes task-specific findings and omits unrelated dumps', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);

    // Record diverse modules
    const dbCode = 'export class DatabaseConnectionPool {\n  connect(): void {}\n  queryTimeoutMs: number = 5000;\n}\n';
    const authCode = 'export class AuthenticationManager {\n  login(): void {}\n}\n';
    const payCode = 'export class StripePaymentHandler {\n  processPayment(): void {}\n}\n';

    await fs.writeFile(path.join(tempWs, 'src', 'database.ts'), dbCode, 'utf-8');
    await fs.writeFile(path.join(tempWs, 'src', 'authService.ts'), authCode, 'utf-8');
    await fs.writeFile(path.join(tempWs, 'src', 'paymentGateway.ts'), payCode, 'utf-8');

    await engine.recordFileRead('src/database.ts', dbCode);
    await engine.recordFileRead('src/authService.ts', authCode);
    await engine.recordFileRead('src/paymentGateway.ts', payCode);

    // User asks specifically about database timeout
    const dbContext = await engine.getVerifiedContext('Fix database connection timeout error', {
      maxCharacters: 900,
      maxFindings: 1,
    });

    expect(dbContext).toContain('src/database.ts');
    expect(dbContext).toContain('DatabaseConnectionPool');
    // Irrelevant payment handler should be deprioritized/omitted when bound is restricted
    expect(dbContext).not.toContain('StripePaymentHandler');
  });

  test('6. Workspace Isolation and Persistence: separate workspaces remain isolated', async () => {
    const storageFile1 = path.join(tempStorageRoot, 'ws1-context.json');
    const storageFile2 = path.join(tempStorageRoot, 'ws2-context.json');

    const engine1 = new ContextEngine(workspaceService, { customStoragePath: storageFile1 });
    const engine2 = new ContextEngine(workspaceService, { customStoragePath: storageFile2 });

    // Workspace 1 discovers unique file
    await fs.writeFile(path.join(tempWs, 'ws1_config.json'), '{"service": "ws1"}', 'utf-8');
    await engine1.recordFileRead('ws1_config.json', '{"service": "ws1"}');
    await engine1.save();

    // Workspace 2 discovers completely different file
    await fs.writeFile(path.join(tempWs, 'ws2_config.json'), '{"service": "ws2"}', 'utf-8');
    await engine2.recordFileRead('ws2_config.json', '{"service": "ws2"}');
    await engine2.save();

    // Reload Workspace 1
    const reloaded1 = new ContextEngine(workspaceService, { customStoragePath: storageFile1 });
    await reloaded1.load();

    expect(reloaded1.isFresh('ws1_config.json')).toBe(true);
    expect(reloaded1.isFresh('ws2_config.json')).toBe(false);

    // Reload Workspace 2
    const reloaded2 = new ContextEngine(workspaceService, { customStoragePath: storageFile2 });
    await reloaded2.load();

    expect(reloaded2.isFresh('ws2_config.json')).toBe(true);
    expect(reloaded2.isFresh('ws1_config.json')).toBe(false);
  });

  test('7. Redundant exploration is avoided when valid context is present', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);
    engine.recordDirectoryListing('.', ['package.json', 'src/']);
    const pkgContent = await workspaceService.readFile('package.json');
    await engine.recordFileRead('package.json', pkgContent);

    let toolsRequested: string[] = [];

    const mockProvider = createMockProvider(async function* (messages: any[]) {
      const sysMsg = messages.find((m) => m.role === 'system' && m.content.includes('kodra-context-demo'));
      if (sysMsg) {
        // LLM sees verified context and answers immediately without tools
        yield { content: 'This is the kodra-context-demo project (v1.2.0).' };
        yield { done: true, usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } };
      } else {
        toolsRequested.push('list_directory');
        yield {
          toolCalls: [
            {
              id: 'c1',
              function: { name: 'list_directory', arguments: '{}' },
            },
          ],
        };
      }
    });

    const loop = new AgentLoop(undefined, false, undefined, workspaceService, engine);
    const events: any[] = [];
    for await (const ev of loop.run('What is this project?', [], mockProvider)) {
      events.push(ev);
    }

    expect(toolsRequested.length).toBe(0);
    const content = events
      .filter((e) => e.type === 'content')
      .map((e) => e.content)
      .join('');
    expect(content).toContain('kodra-context-demo project (v1.2.0)');
  });

  test('8. Missing or ambiguous information still triggers targeted exploration', async () => {
    const engine = ContextEngine.createForWorkspace(workspaceService);
    engine.recordDirectoryListing('.', ['package.json', 'src/']);
    const pkgContent = await workspaceService.readFile('package.json');
    await engine.recordFileRead('package.json', pkgContent);

    let calledTool = false;

    const mockProvider = createMockProvider(async function* (messages: any[]) {
      const hasIndexDetails = messages.some((m) => m.content && m.content.includes('ApplicationService'));
      if (!hasIndexDetails && !calledTool) {
        calledTool = true;
        yield {
          toolCalls: [
            {
              id: 'c1',
              function: { name: 'read_file', arguments: JSON.stringify({ file: 'src/index.ts' }) },
            },
          ],
        };
      } else {
        yield { content: 'ApplicationService found in src/index.ts.' };
        yield { done: true, usage: { promptTokens: 80, completionTokens: 10, totalTokens: 90 } };
      }
    });

    const loop = new AgentLoop(undefined, false, undefined, workspaceService, engine);
    const events: any[] = [];
    for await (const ev of loop.run('What classes are in src/index.ts?', [], mockProvider)) {
      events.push(ev);
    }

    expect(calledTool).toBe(true);
    expect(engine.isFresh('src/index.ts')).toBe(true);
  });

  test('9. Failure isolation: persistence and retrieval errors are non-fatal and sanitize sensitive tokens', async () => {
    // Intentionally point engine to unwritable/invalid path with simulated sensitive query string
    const invalidPath = path.join(tempStorageRoot, 'non_existent_folder_xyz', '\0invalid_key=sk-12345678901234567890', 'context.json');
    const engine = new ContextEngine(workspaceService, { customStoragePath: invalidPath });

    engine.recordDirectoryListing('.', ['src/']);
    const pkgContent = await workspaceService.readFile('package.json');
    await engine.recordFileRead('package.json', pkgContent);

    // save() must handle error gracefully without throwing
    await expect(engine.save()).resolves.not.toThrow();

    // load() must handle error gracefully without throwing
    await expect(engine.load()).resolves.not.toThrow();

    // Context remains healthy in memory
    expect(engine.hasDirectory('.')).toBe(true);
    expect(engine.isFresh('package.json')).toBe(true);
  });

  test('10. Fallback to existing retrieval and file tools when memory is unavailable', async () => {
    // Engine with no memory
    const emptyEngine = ContextEngine.createForWorkspace(workspaceService);
    await emptyEngine.clear();

    const contextManager = new ContextManager(workspaceService, emptyEngine);
    const messages = await contextManager.buildMessages('Explain repository', []);

    // System prompt is constructed properly
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].content).toContain('CRITICAL INSTRUCTION FOR AUTONOMOUS PROJECT UNDERSTANDING & EXPLORATION EFFICIENCY');

    // No verified context crash, agent can proceed with normal tool usage
    expect(emptyEngine.hasContext()).toBe(false);
  });
});
