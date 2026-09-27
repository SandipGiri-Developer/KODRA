import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { VectorStore } from '../../indexing/vectorStore';
import { Chunk } from '../../indexing/types';

describe('VectorStore', () => {
  let tempDir: string;
  let vectorStore: VectorStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'KODRA-test-'));
    vectorStore = new VectorStore(tempDir);
  });

  afterEach(async () => {
    vectorStore.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize empty', () => {
    expect(vectorStore.size).toBe(0);
    expect(vectorStore.getIndexedFiles().size).toBe(0);
  });

  it('should add entries and make them searchable', () => {
    const chunks: Chunk[] = [
      { id: '1', filepath: 'test.ts', content: 'test chunk', startLine: 0, endLine: 1, digest: 'abc', index: 0 },
      { id: '2', filepath: 'test.ts', content: 'another chunk', startLine: 2, endLine: 3, digest: 'abc', index: 1 },
    ];
    
    // Simple 2D vectors
    const vectors = [
      [1.0, 0.0],
      [0.0, 1.0],
    ];

    vectorStore.addEntries(chunks, vectors);
    
    expect(vectorStore.size).toBe(2);
    expect(vectorStore.getIndexedFiles().has('test.ts')).toBe(true);

    // Search near vector 1
    const results1 = vectorStore.search([0.9, 0.1], 1);
    expect(results1.length).toBe(1);
    expect(results1[0].chunk.id).toBe('1');
    expect(results1[0].score).toBeGreaterThan(0.9);

    // Search near vector 2
    const results2 = vectorStore.search([0.1, 0.9], 1);
    expect(results2.length).toBe(1);
    expect(results2[0].chunk.id).toBe('2');
    expect(results2[0].score).toBeGreaterThan(0.9);
  });

  it('should remove entries by filepath', () => {
    const chunks: Chunk[] = [
      { id: '1', filepath: 'test1.ts', content: 'test', startLine: 0, endLine: 1, digest: 'a', index: 0 },
      { id: '2', filepath: 'test2.ts', content: 'test', startLine: 0, endLine: 1, digest: 'b', index: 0 },
    ];
    const vectors = [[1, 0], [0, 1]];

    vectorStore.addEntries(chunks, vectors);
    expect(vectorStore.size).toBe(2);

    const removed = vectorStore.removeByFilepath('test1.ts');
    expect(removed).toBe(1);
    expect(vectorStore.size).toBe(1);
    expect(vectorStore.getIndexedFiles().has('test1.ts')).toBe(false);
    expect(vectorStore.getIndexedFiles().has('test2.ts')).toBe(true);
  });

  it('should save and load from disk', async () => {
    const chunks: Chunk[] = [
      { id: '1', filepath: 'test.ts', content: 'test', startLine: 0, endLine: 1, digest: 'a', index: 0 },
    ];
    const vectors = [[1, 0]];

    vectorStore.addEntries(chunks, vectors);
    await vectorStore.save('test-model');

    // Create a new instance pointing to same dir
    const newStore = new VectorStore(tempDir);
    const loaded = await newStore.load('test-model');
    
    expect(loaded).toBe(true);
    expect(newStore.size).toBe(1);
    expect(newStore.getFileDigest('test.ts')).toBe('a');
  });

  it('should reject loading if model ID differs', async () => {
    const chunks: Chunk[] = [
      { id: '1', filepath: 'test.ts', content: 'test', startLine: 0, endLine: 1, digest: 'a', index: 0 },
    ];
    const vectors = [[1, 0]];

    vectorStore.addEntries(chunks, vectors);
    await vectorStore.save('test-model-1');

    const newStore = new VectorStore(tempDir);
    const loaded = await newStore.load('test-model-2');
    
    expect(loaded).toBe(false);
    expect(newStore.size).toBe(0); // Should be cleared
  });
});
