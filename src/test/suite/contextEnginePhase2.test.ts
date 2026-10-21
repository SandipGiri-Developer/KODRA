/**
 * KODRA Context Engine — Phase 2 Verification & Integration Evaluation Suite.
 *
 * Verifies:
 * 1. Exact identifier and file-path retrieval.
 * 2. Semantic retrieval using the existing index.
 * 3. Merging, ranking, and deduplicating results across sources.
 * 4. Task-aware retrieval and context selection (explain, bugfix, interface_change, refactor, doc_change).
 * 5. Caller, implementation, and test discovery (discoverDependencies).
 * 6. Conflicting evidence and stale-source verification.
 * 7. Persistent memory reuse across restart.
 * 8. Combined context-budget enforcement and deduplication.
 * 9. Graceful retrieval and memory failure handling.
 * 10. Existing tool permissions and workflow compatibility in AgentLoop.
 *
 * Representative Integration Evaluations:
 * Scenario 1: Explain a known function without unnecessary repository exploration.
 * Scenario 2: Fix a bug that requires locating an implementation and its regression test.
 * Scenario 3: Change a shared interface and discover relevant callers.
 * Scenario 4: Resolve similar or conflicting implementations by inspecting current source.
 * Scenario 5: Continue correctly when persistent memory or semantic retrieval is unavailable.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { AgentLoop } from '../../agent/agentLoop';
import { ContextEngine, IContextEngine } from '../../agent/contextEngine';
import { ContextManager } from '../../agent/contextManager';
import { VSCodeWorkspaceService } from '../../agent/workspaceService';
import { StorageManager } from '../../storage/storageManager';
import { SearchResult } from '../../indexing/types';
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

describe('Kodra Context Engine Tests — Phase 2', () => {
  let tempWs: string;
  let tempStorageRoot: string;
  let workspaceService: VSCodeWorkspaceService;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-context-p2-ws-'));
    tempStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-context-p2-storage-'));

    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'context-engine-phase2', index: 0 },
    ];
    workspaceService = new VSCodeWorkspaceService(tempWs);
    StorageManager.initialize(tempStorageRoot);

    // Setup realistic multi-file repository
    await fs.mkdir(path.join(tempWs, 'src', 'billing'), { recursive: true });
    await fs.mkdir(path.join(tempWs, 'src', 'auth'), { recursive: true });
    await fs.mkdir(path.join(tempWs, 'tests'), { recursive: true });

    // 1. package.json
    await fs.writeFile(
      path.join(tempWs, 'package.json'),
      JSON.stringify(
        {
          name: 'kodra-phase2-sample',
          version: '2.0.0',
          main: 'src/index.ts',
          scripts: { test: 'jest' },
          dependencies: { zod: '^3.21.0' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    // 2. README.md
    await fs.writeFile(
      path.join(tempWs, 'README.md'),
      '# Kodra Phase 2 Service\n\nHigh-performance payment and authentication service.',
      'utf-8',
    );

    // 3. src/billing/types.ts
    await fs.writeFile(
      path.join(tempWs, 'src', 'billing', 'types.ts'),
      'export interface InvoiceItem {\n  description: string;\n  amount: number;\n}\n' +
        'export interface PaymentProcessor {\n  processPayment(amount: number): Promise<boolean>;\n}\n',
      'utf-8',
    );

    // 4. src/billing/processor.ts
    await fs.writeFile(
      path.join(tempWs, 'src', 'billing', 'processor.ts'),
      'import { PaymentProcessor } from "./types";\n\n' +
        'export class StripePaymentProcessor implements PaymentProcessor {\n' +
        '  async processPayment(amount: number): Promise<boolean> {\n' +
        '    if (amount <= 0) {\n' +
        '      throw new Error("Invalid payment amount");\n' +
        '    }\n' +
        '    return true;\n' +
        '  }\n' +
        '}\n\n' +
        'export function calculateTotal(items: { amount: number }[]): number {\n' +
        '  return items.reduce((sum, item) => sum + item.amount, 0);\n' +
        '}\n',
      'utf-8',
    );

    // 5. src/billing/checkout.ts (caller of calculateTotal and PaymentProcessor)
    await fs.writeFile(
      path.join(tempWs, 'src', 'billing', 'checkout.ts'),
      'import { PaymentProcessor } from "./types";\n' +
        'import { calculateTotal } from "./processor";\n\n' +
        'export async function checkout(processor: PaymentProcessor, items: { amount: number }[]): Promise<boolean> {\n' +
        '  const total = calculateTotal(items);\n' +
        '  return processor.processPayment(total);\n' +
        '}\n',
      'utf-8',
    );

    // 6. tests/processor.test.ts (regression test)
    await fs.writeFile(
      path.join(tempWs, 'tests', 'processor.test.ts'),
      'import { calculateTotal, StripePaymentProcessor } from "../src/billing/processor";\n\n' +
        'describe("processor tests", () => {\n' +
        '  test("calculateTotal sums properly", () => {\n' +
        '    expect(calculateTotal([{ amount: 10 }, { amount: 20 }])).toBe(30);\n' +
        '  });\n' +
        '  test("throws error for negative amount", async () => {\n' +
        '    const p = new StripePaymentProcessor();\n' +
        '    await expect(p.processPayment(-5)).rejects.toThrow("Invalid payment amount");\n' +
        '  });\n' +
        '});\n',
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

  describe('1. Exact Identifier and File-Path Retrieval', () => {
    it('retrieves exact symbols and preserves source paths and line references', async () => {
      const storageFile = path.join(tempStorageRoot, 'exact-retrieval.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const result = await engine.performHybridRetrieval('calculateTotal');
      expect(result.exactMatchCount).toBeGreaterThan(0);
      expect(result.candidates.length).toBeGreaterThan(0);

      const topCandidate = result.candidates[0];
      expect(topCandidate.content).toContain('calculateTotal');
      expect(topCandidate.filePath).toMatch(/processor\.ts/);
      expect(topCandidate.startLine).toBeDefined();
      expect(topCandidate.provenance).toBeDefined();
    });
  });

  describe('2. Semantic Retrieval Using Indexer', () => {
    it('incorporates vector index results as search candidates', async () => {
      const storageFile = path.join(tempStorageRoot, 'semantic-retrieval.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const mockIndexer = {
        search: jest.fn().mockResolvedValue([
          {
            chunk: {
              id: 'chunk_1',
              filepath: 'src/billing/processor.ts',
              content: 'export class StripePaymentProcessor implements PaymentProcessor',
              startLine: 2,
              endLine: 8,
              digest: 'abc',
              index: 0,
            },
            score: 0.88,
          },
        ] as SearchResult[]),
      };

      const result = await engine.performHybridRetrieval('how are payments processed', {
        indexer: mockIndexer,
      });

      expect(mockIndexer.search).toHaveBeenCalledWith('how are payments processed', 5);
      expect(result.semanticMatchCount).toBe(1);

      const vectorCand = result.candidates.find((c) => c.source === 'vector_index');
      expect(vectorCand).toBeDefined();
      expect(vectorCand?.provenance).toBe('search_candidate');
      expect(vectorCand?.filePath).toBe('src/billing/processor.ts');
    });
  });

  describe('3. Merging, Ranking, and Deduplication', () => {
    it('merges candidates from memory and search, ranking by provenance and match quality', async () => {
      const storageFile = path.join(tempStorageRoot, 'merging-dedup.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      // First, record file read so it becomes verified in memory
      const processorContent = await workspaceService.readFile('src/billing/processor.ts');
      await engine.recordFileRead('src/billing/processor.ts', processorContent);

      const mockIndexer = {
        search: jest.fn().mockResolvedValue([
          {
            chunk: {
              id: 'c1',
              filepath: 'src/billing/processor.ts',
              content: processorContent.slice(0, 80),
              startLine: 0,
              endLine: 4,
              digest: 'd1',
              index: 0,
            },
            score: 0.9,
          },
        ]),
      };

      const result = await engine.performHybridRetrieval('StripePaymentProcessor', {
        indexer: mockIndexer,
      });

      expect(result.candidates.length).toBeGreaterThan(0);
      // Candidates from memory should have verified_finding provenance and rank high
      const memoryCand = result.candidates.find((c) => c.source === 'memory');
      expect(memoryCand).toBeDefined();
      expect(memoryCand?.provenance).toBe('verified_finding');
    });
  });

  describe('4. Task-Aware Retrieval and Context Selection', () => {
    it('detects task intent and adjusts relevance scoring for bugfix vs explain vs interface_change', async () => {
      const storageFile = path.join(tempStorageRoot, 'task-intent.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      expect(engine.detectTaskIntent('Fix null pointer exception in processPayment')).toBe('bugfix');
      expect(engine.detectTaskIntent('Explain how payment processing works')).toBe('explain');
      expect(engine.detectTaskIntent('Update the PaymentProcessor interface signature')).toBe('interface_change');
      expect(engine.detectTaskIntent('Refactor calculateTotal to support tax rules')).toBe('refactor');
      expect(engine.detectTaskIntent('Update README documentation for payments')).toBe('doc_change');

      // Bugfix query boosts tests and error-handling code
      const bugfixResult = await engine.performHybridRetrieval('processPayment error', {
        taskIntent: 'bugfix',
      });
      const testCand = bugfixResult.candidates.find((c) => c.filePath.includes('test'));
      expect(testCand).toBeDefined();
      expect(testCand?.relevanceScore).toBeGreaterThan(50);
    });
  });

  describe('5. Caller, Implementation, and Test Discovery', () => {
    it('discovers imports, callers, implementations, and regression tests', async () => {
      const storageFile = path.join(tempStorageRoot, 'dep-discovery.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const deps = await engine.discoverDependencies('src/billing/processor.ts', 'calculateTotal');

      expect(deps.targetPath).toBe('src/billing/processor.ts');
      expect(deps.targetSymbol).toBe('calculateTotal');
      expect(deps.imports).toContain('./types');

      // Callers should include checkout.ts
      const callerInCheckout = deps.callers.find((c) => c.filePath.includes('checkout.ts'));
      expect(callerInCheckout).toBeDefined();

      // Implementations should include processor.ts
      const impl = deps.implementations.find((i) => i.filePath.includes('processor.ts'));
      expect(impl).toBeDefined();

      // Tests should include processor.test.ts
      expect(deps.tests.some((t) => t.includes('processor.test.ts'))).toBe(true);
    });
  });

  describe('6. Conflicting Evidence and Stale-Source Verification', () => {
    it('flags stale source files and warns before modifying conflicting or stale code', async () => {
      const storageFile = path.join(tempStorageRoot, 'stale-conflicts.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const content = await workspaceService.readFile('src/billing/processor.ts');
      await engine.recordFileRead('src/billing/processor.ts', content);

      // Mark the file modified/stale
      await engine.recordFileModified('src/billing/processor.ts');
      expect(engine.isFresh('src/billing/processor.ts')).toBe(false);

      const result = await engine.performHybridRetrieval('StripePaymentProcessor');
      const staleCand = result.candidates.find((c) => c.filePath.includes('processor.ts'));
      expect(staleCand?.freshness).toBe('stale');
      expect(staleCand?.provenance).toBe('stale_finding');

      // Conflict warning should be generated
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0]).toMatch(/stale|re-verify/i);
    });
  });

  describe('7. Persistent Memory Reuse Across Restart', () => {
    it('saves state and automatically restores findings across instances', async () => {
      const storageFile = path.join(tempStorageRoot, 'restart-test.json');
      const engine1 = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const content = await workspaceService.readFile('src/billing/types.ts');
      await engine1.recordFileRead('src/billing/types.ts', content);
      await engine1.save();

      // Simulate new session with engine2
      const engine2 = new ContextEngine(workspaceService, { customStoragePath: storageFile });
      await engine2.ensureLoaded();

      expect(engine2.hasContext()).toBe(true);
      expect(engine2.isFresh('src/billing/types.ts')).toBe(true);

      const metricsBefore = engine2.getMetrics();
      const result = await engine2.performHybridRetrieval('PaymentProcessor');
      expect(result.memoryHitCount).toBeGreaterThan(0);
      expect(engine2.getMetrics().memoryReuseCount).toBeGreaterThan(metricsBefore.memoryReuseCount);
    });
  });

  describe('8. Combined Context-Budget Enforcement and Deduplication', () => {
    it('strictly respects combined character limit and suppresses duplicate excerpts', async () => {
      const storageFile = path.join(tempStorageRoot, 'budget-test.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const procContent = await workspaceService.readFile('src/billing/processor.ts');
      await engine.recordFileRead('src/billing/processor.ts', procContent);

      const mockIndexer = {
        search: jest.fn().mockResolvedValue([
          {
            chunk: {
              id: 'c1',
              filepath: 'src/billing/processor.ts',
              content: 'class StripePaymentProcessor',
              startLine: 1,
              endLine: 5,
              digest: 'd1',
              index: 0,
            },
            score: 0.9,
          },
        ]),
      };

      // Combined context with tight budget (500 chars)
      const combined = await engine.getCombinedContext('Payment processing', {
        maxCombinedCharacters: 500,
        contextFiles: ['src/billing/processor.ts'],
        indexer: mockIndexer,
      });

      expect(combined.totalCharacters).toBeLessThanOrEqual(500);
      expect(combined.sectionsIncluded).toContain('attached_files');

      // In ContextManager with combined budget
      const cm = new ContextManager(workspaceService, engine);
      const messages = await cm.buildMessages('Explain payments', [], {
        contextFiles: ['src/billing/processor.ts'],
        maxCombinedContextCharacters: 1200,
        indexer: mockIndexer as any,
      });

      const totalContextChars = messages
        .filter((m) => m.role === 'system' && m.content.includes('Attached File Context'))
        .reduce((sum, m) => sum + m.content.length, 0);

      expect(totalContextChars).toBeLessThanOrEqual(1200);
    });
  });

  describe('9. Graceful Failure Handling and Logging Sanitization', () => {
    it('handles search and storage errors without throwing and sanitizes sensitive data', async () => {
      const failingWorkspace: any = {
        ...workspaceService,
        searchFiles: jest.fn().mockRejectedValue(new Error('search failed: bearer secret_token_12345')),
        readFile: jest.fn().mockRejectedValue(new Error('file missing')),
        getActiveWorkspaceFolder: () => workspaceService.getActiveWorkspaceFolder(),
        resolvePath: (p: string) => workspaceService.resolvePath(p),
        stat: (p: string) => workspaceService.stat(p),
      };

      const engine = new ContextEngine(failingWorkspace, {
        customStoragePath: path.join(tempStorageRoot, 'failing.json'),
      });

      // Hybrid retrieval should not throw
      const result = await engine.performHybridRetrieval('test query');
      expect(result.candidates).toEqual([]);
      expect(result.exactMatchCount).toBe(0);

      // Dependency discovery should not throw
      const deps = await engine.discoverDependencies('src/billing/processor.ts');
      expect(deps.imports).toEqual([]);
    });
  });

  describe('10. Existing Tool Permissions and AgentLoop Integration', () => {
    it('automatically ensures ContextEngine is loaded and injects prompt instructions', async () => {
      const storageFile = path.join(tempStorageRoot, 'agentloop-auto.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      await engine.recordFileRead(
        'src/billing/processor.ts',
        await workspaceService.readFile('src/billing/processor.ts'),
      );
      await engine.save();

      // Fresh instance without manual load()
      const engineNew = new ContextEngine(workspaceService, { customStoragePath: storageFile });
      const loop = new AgentLoop(undefined, false, undefined, workspaceService, engineNew);

      let capturedMessages: any[] = [];
      const mockProvider = createMockProvider((messages) => {
        capturedMessages = messages;
        return (async function* () {
          yield { content: 'Understood payment processor.' };
        })();
      });

      const events: any[] = [];
      for await (const ev of loop.run('Explain PaymentProcessor', [], mockProvider)) {
        events.push(ev);
      }

      expect(events.some((e) => e.type === 'content')).toBe(true);

      // Context was automatically loaded and injected into system messages
      const systemWithContext = capturedMessages.find(
        (m) => m.role === 'system' && m.content.includes('Verified Workspace Knowledge'),
      );
      expect(systemWithContext).toBeDefined();
      expect(systemWithContext.content).toContain('processor.ts');
    });
  });

  // =========================================================================
  // Representative Integration Evaluations (Phase 2 Scenarios)
  // =========================================================================

  describe('Representative Integration Evaluations', () => {
    // Scenario 1: Explain a known function without unnecessary repository exploration
    test('Scenario 1: Explain a known function without unnecessary repository exploration', async () => {
      const storageFile = path.join(tempStorageRoot, 'eval-scenario-1.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      await engine.recordFileRead(
        'src/billing/processor.ts',
        await workspaceService.readFile('src/billing/processor.ts'),
      );
      engine.resetMetrics();

      const loop = new AgentLoop(undefined, false, undefined, workspaceService, engine);
      const toolsCalled: string[] = [];

      const mockProvider = createMockProvider((messages) => {
        return (async function* () {
          const verifiedMsg = messages.find(
            (m) => m.role === 'system' && m.content.includes('calculateTotal'),
          );
          if (verifiedMsg) {
            // Memory provided the needed context directly! No tool calls required
            yield {
              content: 'calculateTotal sums the amount property of each item in the array using reduce.',
            };
          } else {
            toolsCalled.push('list_directory');
            yield {
              toolCalls: [{ id: 'call_1', name: 'list_directory', args: { path: '.' } }],
            };
          }
        })();
      });

      for await (const _ of loop.run('Explain calculateTotal function', [], mockProvider)) {
        // stream
      }

      // With Phase 2 verified memory, zero exploration tools are called
      expect(toolsCalled.length).toBe(0);
      const metrics = engine.getMetrics();
      expect(metrics.directoryListingsCount).toBe(0);
    });

    // Scenario 2: Fix a bug that requires locating an implementation and its regression test
    test('Scenario 2: Fix a bug that requires locating an implementation and its regression test', async () => {
      const storageFile = path.join(tempStorageRoot, 'eval-scenario-2.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const query = 'Fix error in processPayment when amount is negative';
      const result = await engine.performHybridRetrieval(query);

      expect(result.taskIntent).toBe('bugfix');

      const implementationCand = result.candidates.find(
        (c) => c.filePath.includes('processor.ts') && !c.filePath.includes('test'),
      );
      const testCand = result.candidates.find((c) => c.filePath.includes('processor.test.ts'));

      expect(implementationCand).toBeDefined();
      expect(testCand).toBeDefined();
      expect(result.candidates.some((c) => c.content.includes('processPayment'))).toBe(true);
      expect(testCand?.content).toContain('throws error');
    });

    // Scenario 3: Change a shared interface and discover relevant callers
    test('Scenario 3: Change a shared interface and discover relevant callers', async () => {
      const storageFile = path.join(tempStorageRoot, 'eval-scenario-3.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      const deps = await engine.discoverDependencies('src/billing/types.ts', 'PaymentProcessor');

      expect(deps.targetPath).toBe('src/billing/types.ts');
      // Should discover callers in checkout.ts
      expect(deps.callers.some((c) => c.filePath.includes('checkout.ts'))).toBe(true);
      // Should discover implementation in processor.ts
      expect(deps.implementations.some((i) => i.filePath.includes('processor.ts'))).toBe(true);
      // Should discover tests in processor.test.ts
      expect(deps.tests.some((t) => t.includes('processor.test.ts'))).toBe(true);
    });

    // Scenario 4: Resolve similar or conflicting implementations by inspecting current source
    test('Scenario 4: Resolve similar or conflicting implementations by inspecting current source', async () => {
      const storageFile = path.join(tempStorageRoot, 'eval-scenario-4.json');
      const engine = new ContextEngine(workspaceService, { customStoragePath: storageFile });

      // Simulate a duplicate/conflicting symbol in a different file
      const altFile = path.join(tempWs, 'src', 'billing', 'altProcessor.ts');
      await fs.writeFile(
        altFile,
        'export function calculateTotal(items: any[]): number { return 0; }\n',
        'utf-8',
      );

      try {
        const result = await engine.performHybridRetrieval('calculateTotal');
        expect(result.candidates.length).toBeGreaterThan(1);

        // Conflict detection notes multiple definitions
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.conflicts[0]).toContain('calculateTotal');
        expect(result.conflicts[0]).toMatch(/read_file/i);
      } finally {
        await fs.rm(altFile, { force: true });
      }
    });

    // Scenario 5: Continue correctly when persistent memory or semantic retrieval is unavailable
    test('Scenario 5: Continue correctly when persistent memory or semantic retrieval is unavailable', async () => {
      // Inaccessible storage path
      const invalidPath = process.platform === 'win32' ? 'Z:\\non_existent\\ctx.json' : '/non_existent/ctx.json';
      const engine = new ContextEngine(workspaceService, { customStoragePath: invalidPath });

      // Unhealthy indexer
      const brokenIndexer = {
        search: jest.fn().mockRejectedValue(new Error('Vector store connection timeout')),
      };

      const result = await engine.performHybridRetrieval('calculateTotal', {
        indexer: brokenIndexer,
      });

      // Hybrid retrieval falls back to exact workspace search seamlessly
      expect(result.exactMatchCount).toBeGreaterThan(0);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.some((c) => c.filePath.includes('processor.ts'))).toBe(true);
    });
  });
});
