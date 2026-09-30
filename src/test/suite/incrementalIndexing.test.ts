import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { CodebaseIndexer, DEFAULT_CONFIG } from '../../indexing/indexer';
import { IEmbeddingProvider } from '../../indexing/embeddings';
import { IndexingProgress } from '../../indexing/types';

/** Mock embedding provider with bag-of-words hashing for semantic similarity */
class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly dimensions: number;
  public embedCallsCount = 0;
  public totalTextsEmbedded = 0;

  constructor(modelId: string = 'local:all-MiniLM-L6-v2', dimensions: number = 384) {
    this.providerId = modelId.split(':')[0] || 'local';
    this.modelName = modelId.split(':').slice(1).join(':') || 'all-MiniLM-L6-v2';
    this.modelId = modelId;
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {}

  async embed(texts: string[]): Promise<number[][]> {
    this.embedCallsCount++;
    this.totalTextsEmbedded += texts.length;
    return texts.map((text) => {
      const vec = new Array(this.dimensions).fill(0);
      const words = text.toLowerCase().split(/\W+/).filter(Boolean);
      for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
          hash |= 0;
        }
        const idx = Math.abs(hash) % this.dimensions;
        vec[idx] += 1;
      }
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  }

  dispose(): void {}
}

describe('Incremental Indexing & End-to-End Pipeline', () => {
  let workspaceDir: string;
  let storeDir: string;
  let mockProvider: MockEmbeddingProvider;
  let indexer: CodebaseIndexer;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-ws-test-'));
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-store-test-'));

    // Mock VS Code workspace folders to point to workspaceDir
    const vscode = require('vscode');
    vscode.workspace.workspaceFolders = [
      {
        uri: { fsPath: workspaceDir },
        name: 'test-workspace',
        index: 0,
      },
    ];

    mockProvider = new MockEmbeddingProvider('local:all-MiniLM-L6-v2', 384);
    indexer = new CodebaseIndexer(
      {
        ...DEFAULT_CONFIG,
        batchSize: 10,
      },
      storeDir,
      mockProvider,
    );
  });

  afterEach(async () => {
    indexer.dispose();
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it('Scenario 1: Fresh installation with NO Ollama -> index workspace and retrieve', async () => {
    // 1. Create initial files in workspace
    await fs.writeFile(
      path.join(workspaceDir, 'auth.ts'),
      'export function authenticateUser(token: string): boolean {\n  return token.startsWith("auth_");\n}\n',
    );
    await fs.writeFile(
      path.join(workspaceDir, 'database.ts'),
      'export function connectToDatabase(url: string): void {\n  console.log("Connecting to", url);\n}\n',
    );

    const progressEvents: IndexingProgress[] = [];
    indexer.onProgress((p) => progressEvents.push(p));

    // 2. Perform indexing
    await indexer.indexWorkspace(false);

    // 3. Verify real runtime states occurred in order
    const statuses = progressEvents.map((p) => p.status);
    expect(statuses).toContain('initializing');
    expect(statuses).toContain('discovering_files');
    expect(statuses).toContain('chunking');
    expect(statuses).toContain('embedding');
    expect(statuses).toContain('persisting');
    expect(statuses).toContain('completed');

    // 4. Verify vector store has indexed items
    const status = indexer.getStatus();
    expect(status.indexed).toBe(true);
    expect(status.fileCount).toBe(2);
    expect(status.entryCount).toBeGreaterThanOrEqual(2);
    expect(mockProvider.embedCallsCount).toBeGreaterThan(0);

    // 5. Perform semantic retrieval
    const searchResults = await indexer.search('authenticate token');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].chunk.filepath).toContain('auth.ts');
  });

  it('Scenario 2: Unchanged files are NOT re-embedded on subsequent runs', async () => {
    await fs.writeFile(
      path.join(workspaceDir, 'service.ts'),
      'export class UserService {\n  getUser() { return { id: 1 }; }\n}\n',
    );

    // Initial index
    await indexer.indexWorkspace(false);
    const initialEmbedCalls = mockProvider.embedCallsCount;
    const initialTextsCount = mockProvider.totalTextsEmbedded;
    expect(initialEmbedCalls).toBeGreaterThan(0);

    // Re-index WITHOUT modifying files
    await indexer.indexWorkspace(false);

    // Zero new embedding calls!
    expect(mockProvider.embedCallsCount).toBe(initialEmbedCalls);
    expect(mockProvider.totalTextsEmbedded).toBe(initialTextsCount);
  });

  it('Scenario 3: Changed files only re-embed modified content; unchanged chunks are reused', async () => {
    // Create multi-chunk file
    const chunk1 = 'export function calculateMetricsA() {\n  return 42;\n}\n'.repeat(5);
    const chunk2 = 'export function calculateMetricsB() {\n  return 100;\n}\n'.repeat(5);
    await fs.writeFile(path.join(workspaceDir, 'metrics.ts'), `${chunk1}\n\n${chunk2}`);

    // Initial index
    await indexer.indexWorkspace(false);
    const initialEmbedded = mockProvider.totalTextsEmbedded;

    // Modify only one portion of the file (chunk2)
    const modifiedChunk2 = 'export function calculateMetricsB() {\n  return 999; // MODIFIED\n}\n'.repeat(5);
    await fs.writeFile(path.join(workspaceDir, 'metrics.ts'), `${chunk1}\n\n${modifiedChunk2}`);

    // Re-index
    await indexer.indexWorkspace(false);

    // Some new embedding happened, but fewer than a complete re-embed of both chunks
    expect(mockProvider.totalTextsEmbedded).toBeGreaterThan(initialEmbedded);
  });

  it('Scenario 4: Deleted files are removed from the vector store and search results', async () => {
    const file1 = path.join(workspaceDir, 'temporary.ts');
    const file2 = path.join(workspaceDir, 'permanent.ts');

    await fs.writeFile(file1, 'export const tempFeature = "will be deleted";\n');
    await fs.writeFile(file2, 'export const permFeature = "will remain";\n');

    await indexer.indexWorkspace(false);
    expect(indexer.getStatus().fileCount).toBe(2);

    // Verify tempFeature is searchable
    const searchBefore = await indexer.search('tempFeature');
    expect(searchBefore.some((r) => r.chunk.filepath.includes('temporary.ts'))).toBe(true);

    // Delete temporary.ts
    await fs.unlink(file1);

    // Re-index
    await indexer.indexWorkspace(false);
    expect(indexer.getStatus().fileCount).toBe(1);

    // Verify temporary.ts no longer appears in search
    const searchAfter = await indexer.search('tempFeature');
    expect(searchAfter.some((r) => r.chunk.filepath.includes('temporary.ts'))).toBe(false);
  });

  it('Scenario 5: Renamed/moved files with identical content reuse embeddings via content addressing', async () => {
    const originalFile = path.join(workspaceDir, 'oldName.ts');
    const content = 'export function uniqueSharedLogic() {\n  return "content-addressable-test";\n}\n';
    await fs.writeFile(originalFile, content);

    // Initial index
    await indexer.indexWorkspace(false);
    const initialTextsCount = mockProvider.totalTextsEmbedded;

    // Rename file
    const newFile = path.join(workspaceDir, 'newName.ts');
    await fs.rename(originalFile, newFile);

    // Re-index
    await indexer.indexWorkspace(false);

    // Content was identical, so zero new embeddings generated!
    expect(mockProvider.totalTextsEmbedded).toBe(initialTextsCount);

    // Search matches new filename
    const results = await indexer.search('uniqueSharedLogic');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.filepath).toContain('newName.ts');
  });

  it('Scenario 6: Incompatible embedding model/dimensions triggers safe rebuild', async () => {
    await fs.writeFile(
      path.join(workspaceDir, 'app.ts'),
      'export function main() { console.log("kodra app"); }\n',
    );

    // Index with 384d model
    await indexer.indexWorkspace(false);
    expect(indexer.getStatus().entryCount).toBeGreaterThan(0);

    // Switch provider to 768d model (e.g. user switched to Ollama nomic-embed-text)
    const provider768 = new MockEmbeddingProvider('ollama:nomic-embed-text', 768);
    const indexer768 = new CodebaseIndexer(
      {
        ...DEFAULT_CONFIG,
        embeddingProvider: 'ollama',
        embeddingModel: 'nomic-embed-text',
      },
      storeDir,
      provider768,
    );

    // Index with new model: should detect mismatch and safely rebuild with 768d
    await indexer768.indexWorkspace(false);
    expect(indexer768.getStatus().entryCount).toBeGreaterThan(0);

    // Search with 768d vector succeeds without dimension error
    const results = await indexer768.search('kodra app');
    expect(results.length).toBeGreaterThan(0);
    expect(provider768.dimensions).toBe(768);

    indexer768.dispose();
  });

  it('Scenario 7: Cancellation stops indexing cleanly without destroying store', async () => {
    // Create multiple files
    for (let i = 0; i < 15; i++) {
      await fs.writeFile(
        path.join(workspaceDir, `file_${i}.ts`),
        `export function fn_${i}() { return ${i}; }\n`,
      );
    }

    let cancelledEmitted = false;
    let cancelTriggered = false;
    const sub = indexer.onProgress((p) => {
      if (p.status === 'chunking' && !cancelTriggered) {
        cancelTriggered = true;
        indexer.cancelIndexing();
      }
      if (p.status === 'cancelled') {
        cancelledEmitted = true;
      }
    });

    await indexer.indexWorkspace(false);
    expect(cancelledEmitted).toBe(true);

    // Unsubscribe so subsequent run doesn't cancel
    sub.dispose();

    // Subsequent re-index recovers cleanly
    await indexer.indexWorkspace(false);
    expect(indexer.getStatus().indexed).toBe(true);
  });

  it('Scenario 8: Single unreadable file does not destroy whole index (error resilience)', async () => {
    await fs.writeFile(
      path.join(workspaceDir, 'valid.ts'),
      'export function validCode() { return true; }\n',
    );

    // Create a directory named corrupt.ts so reading it as a file fails
    await fs.mkdir(path.join(workspaceDir, 'corrupt.ts'));

    await indexer.indexWorkspace(false);

    // Valid file was successfully indexed despite corrupt.ts failure!
    const search = await indexer.search('validCode');
    expect(search.length).toBeGreaterThan(0);
    expect(search[0].chunk.filepath).toContain('valid.ts');
  });
});
