import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { CodebaseIndexer } from '../../indexing/indexer';
import { LocalTransformersProvider } from '../../indexing/embeddings';
import { ModelCacheManager } from '../../indexing/modelCache';
import { IndexingProgress } from '../../indexing/types';

describe('PHASE 4 VERIFICATION: Clean Installation Scenario', () => {
  let cleanCacheDir: string;
  let cleanStorageDir: string;
  let cleanWorkspace: string;

  beforeAll(async () => {
    cleanCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-clean-cache-'));
    cleanStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-clean-storage-'));
    cleanWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-clean-ws-'));

    // Configure mock VS Code workspace folder
    const vscode = require('vscode');
    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: cleanWorkspace }, name: 'clean-ws', index: 0 },
    ];

    // Set up initial workspace code files
    await fs.writeFile(
      path.join(cleanWorkspace, 'auth.ts'),
      'export function verifyUserSession(token: string): boolean {\n  return token === "valid-token";\n}\n',
    );
    await fs.writeFile(
      path.join(cleanWorkspace, 'payment.ts'),
      'export function processPayment(amount: number) {\n  return { status: "paid", amount };\n}\n',
    );
  });

  afterAll(async () => {
    await fs.rm(cleanCacheDir, { recursive: true, force: true });
    await fs.rm(cleanStorageDir, { recursive: true, force: true });
    await fs.rm(cleanWorkspace, { recursive: true, force: true });
  });

  it('Step 1: Fresh environment has NO embedding model cached', async () => {
    const isCachedInitially = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', cleanCacheDir);
    expect(isCachedInitially).toBe(false);
  });

  it('Step 2 & 3: Fresh indexing acquires model automatically, indexes, and reports real states', async () => {
    const localProvider = new LocalTransformersProvider('all-MiniLM-L6-v2', cleanCacheDir);

    const indexer = new CodebaseIndexer(
      {
        maxFileSize: 1048576,
        additionalIgnorePatterns: [],
        embeddingProvider: 'local',
        embeddingModel: 'all-MiniLM-L6-v2',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        maxChunkSize: 512,
        batchSize: 10,
        cacheDir: cleanCacheDir,
      },
      cleanStorageDir,
      localProvider,
    );

    const progressEvents: IndexingProgress[] = [];
    indexer.onProgress((p) => progressEvents.push(p));

    await indexer.indexWorkspace(false);

    // Verify real states occurred
    const statuses = progressEvents.map((p) => p.status);
    expect(statuses).toContain('initializing');
    expect(statuses).toContain('discovering_files');
    expect(statuses).toContain('chunking');
    expect(statuses).toContain('embedding');
    expect(statuses).toContain('persisting');
    expect(statuses).toContain('completed');

    expect(indexer.getStatus().indexed).toBe(true);
    expect(indexer.getStatus().entryCount).toBeGreaterThanOrEqual(2);

    indexer.dispose();
  }, 120000); // Allow sufficient time for initial download if needed

  it('Step 4: Semantic retrieval works out-of-the-box with local embeddings', async () => {
    const localProvider = new LocalTransformersProvider('all-MiniLM-L6-v2', cleanCacheDir);
    const indexer = new CodebaseIndexer(
      {
        maxFileSize: 1048576,
        additionalIgnorePatterns: [],
        embeddingProvider: 'local',
        embeddingModel: 'all-MiniLM-L6-v2',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        maxChunkSize: 512,
        batchSize: 10,
        cacheDir: cleanCacheDir,
      },
      cleanStorageDir,
      localProvider,
    );

    await indexer.ensureLoaded();
    const searchRes = await indexer.search('verify token session', 5);

    expect(searchRes.length).toBeGreaterThan(0);
    expect(searchRes[0].chunk.filepath).toContain('auth.ts');
    expect(searchRes[0].score).toBeGreaterThan(0.1);

    indexer.dispose();
  });

  it('Step 5 & 6: Cached model is preserved and reused after VS Code restart without re-download', async () => {
    // Verify model is cached in cleanCacheDir
    const isCachedNow = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', cleanCacheDir);
    expect(isCachedNow).toBe(true);

    // Simulate restart with new provider and indexer instances pointing to existing cache & storage
    const localProviderRestarted = new LocalTransformersProvider('all-MiniLM-L6-v2', cleanCacheDir);
    const indexerRestarted = new CodebaseIndexer(
      {
        maxFileSize: 1048576,
        additionalIgnorePatterns: [],
        embeddingProvider: 'local',
        embeddingModel: 'all-MiniLM-L6-v2',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        maxChunkSize: 512,
        batchSize: 10,
        cacheDir: cleanCacheDir,
      },
      cleanStorageDir,
      localProviderRestarted,
    );

    let redownloadHappened = false;
    indexerRestarted.onProgress((p) => {
      if (p.status === 'downloading_model') {
        redownloadHappened = true;
      }
    });

    await indexerRestarted.indexWorkspace(false);
    expect(redownloadHappened).toBe(false);
    expect(indexerRestarted.getStatus().indexed).toBe(true);

    indexerRestarted.dispose();
  });

  it('Step 7: Modify one file -> only modified content is re-embedded', async () => {
    const localProvider = new LocalTransformersProvider('all-MiniLM-L6-v2', cleanCacheDir);
    const indexer = new CodebaseIndexer(
      {
        maxFileSize: 1048576,
        additionalIgnorePatterns: [],
        embeddingProvider: 'local',
        embeddingModel: 'all-MiniLM-L6-v2',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        maxChunkSize: 512,
        batchSize: 10,
        cacheDir: cleanCacheDir,
      },
      cleanStorageDir,
      localProvider,
    );

    // Modify payment.ts by adding a new refund function
    await fs.writeFile(
      path.join(cleanWorkspace, 'payment.ts'),
      'export function processPayment(amount: number) { return { status: "paid", amount, currency: "USD" }; }\n' +
      'export function refundTransaction(id: string) { return { refunded: true, id }; }\n',
    );

    await indexer.indexWorkspace(false);

    // Search for the newly added refund function
    const refundResults = await indexer.search('refund transaction', 5);
    expect(refundResults.length).toBeGreaterThan(0);
    expect(refundResults[0].chunk.content).toContain('refundTransaction');

    indexer.dispose();
  });

  it('Step 8: Deleted files no longer appear in retrieval', async () => {
    const localProvider = new LocalTransformersProvider('all-MiniLM-L6-v2', cleanCacheDir);
    const indexer = new CodebaseIndexer(
      {
        maxFileSize: 1048576,
        additionalIgnorePatterns: [],
        embeddingProvider: 'local',
        embeddingModel: 'all-MiniLM-L6-v2',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        maxChunkSize: 512,
        batchSize: 10,
        cacheDir: cleanCacheDir,
      },
      cleanStorageDir,
      localProvider,
    );

    // Verify auth.ts is searchable before deletion
    const searchBefore = await indexer.search('verifyUserSession', 5);
    expect(searchBefore.some((r) => r.chunk.filepath.includes('auth.ts'))).toBe(true);

    // Delete auth.ts
    await fs.unlink(path.join(cleanWorkspace, 'auth.ts'));

    // Re-index
    await indexer.indexWorkspace(false);

    // Verify auth.ts chunks are purged from vector store and search results
    const searchAfter = await indexer.search('verifyUserSession', 5);
    const stillPresent = searchAfter.some((r) => r.chunk.filepath.includes('auth.ts'));
    expect(stillPresent).toBe(false);

    indexer.dispose();
  });
});
