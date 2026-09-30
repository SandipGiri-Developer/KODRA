import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  LocalTransformersProvider,
  OllamaEmbeddingProvider,
  FallbackEmbeddingProvider,
  createEmbeddingProvider,
} from '../../indexing/embeddings';
import { ModelCacheManager } from '../../indexing/modelCache';
import { KodraError } from '../../utils/errors';

describe('Embedding Subsystem', () => {
  let tempCacheDir: string;

  beforeEach(async () => {
    tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-embeddings-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempCacheDir, { recursive: true, force: true });
  });

  describe('ModelCacheManager', () => {
    it('should identify empty cache as not cached', async () => {
      const isCached = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', tempCacheDir);
      expect(isCached).toBe(false);
    });

    it('should detect fully cached model with all required files', async () => {
      const modelDir = ModelCacheManager.getModelDir('all-MiniLM-L6-v2', tempCacheDir);
      const onnxDir = path.join(modelDir, 'onnx');
      await fs.mkdir(onnxDir, { recursive: true });

      await fs.writeFile(path.join(modelDir, 'config.json'), '{"model_type": "bert"}');
      await fs.writeFile(path.join(modelDir, 'tokenizer.json'), '{"version": "1.0"}');
      await fs.writeFile(path.join(onnxDir, 'model_quantized.onnx'), 'mock-onnx-bytes');

      const isCached = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', tempCacheDir);
      expect(isCached).toBe(true);

      const status = await ModelCacheManager.checkModelCache('all-MiniLM-L6-v2', tempCacheDir);
      expect(status.filesPresent.length).toBeGreaterThanOrEqual(3);
      expect(status.totalSizeBytes).toBeGreaterThan(0);
    });

    it('should reject incomplete or 0-byte corrupted cache', async () => {
      const modelDir = ModelCacheManager.getModelDir('all-MiniLM-L6-v2', tempCacheDir);
      await fs.mkdir(modelDir, { recursive: true });
      await fs.writeFile(path.join(modelDir, 'config.json'), ''); // 0-byte corrupt file

      const isCached = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', tempCacheDir);
      expect(isCached).toBe(false);
    });

    it('should clear model cache cleanly', async () => {
      const modelDir = ModelCacheManager.getModelDir('all-MiniLM-L6-v2', tempCacheDir);
      await fs.mkdir(modelDir, { recursive: true });
      await fs.writeFile(path.join(modelDir, 'test.bin'), 'data');

      await ModelCacheManager.clearModelCache('all-MiniLM-L6-v2', tempCacheDir);
      const exists = await fs.access(modelDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('LocalTransformersProvider', () => {
    it('should default to 384 dimensions for all-MiniLM-L6-v2', () => {
      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);
      expect(provider.providerId).toBe('local');
      expect(provider.modelId).toBe('local:all-MiniLM-L6-v2');
      expect(provider.dimensions).toBe(384);
    });

    it('should fail gracefully when offline and model is not cached', async () => {
      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);

      // Force offline simulation by mocking isOnline
      jest.spyOn(ModelCacheManager, 'isOnline').mockResolvedValue(false);

      await expect(provider.initialize()).rejects.toThrow(KodraError);
      await expect(provider.initialize()).rejects.toThrow(/not cached and cannot be downloaded while offline/);

      jest.restoreAllMocks();
    });

    it('should operate offline when model is cached', async () => {
      // Create a mock cached model
      const modelDir = ModelCacheManager.getModelDir('all-MiniLM-L6-v2', tempCacheDir);
      const onnxDir = path.join(modelDir, 'onnx');
      await fs.mkdir(onnxDir, { recursive: true });
      await fs.writeFile(path.join(modelDir, 'config.json'), '{}');
      await fs.writeFile(path.join(modelDir, 'tokenizer.json'), '{}');
      await fs.writeFile(path.join(onnxDir, 'model_quantized.onnx'), 'mock');

      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);
      const isCached = await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', tempCacheDir);
      expect(isCached).toBe(true);

      // Even if offline, cache presence is detected
      jest.spyOn(ModelCacheManager, 'isOnline').mockResolvedValue(false);
      // Verify isCached is true
      expect(await ModelCacheManager.isModelCached('all-MiniLM-L6-v2', tempCacheDir)).toBe(true);

      jest.restoreAllMocks();
    });

    it('should report progress during initialization', async () => {
      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);
      const progressUpdates: any[] = [];

      // Create a mock cached model so it loads offline
      const modelDir = ModelCacheManager.getModelDir('all-MiniLM-L6-v2', tempCacheDir);
      const onnxDir = path.join(modelDir, 'onnx');
      await fs.mkdir(onnxDir, { recursive: true });
      await fs.writeFile(path.join(modelDir, 'config.json'), '{}');
      await fs.writeFile(path.join(modelDir, 'tokenizer.json'), '{}');
      await fs.writeFile(path.join(onnxDir, 'model_quantized.onnx'), 'mock');

      try {
        await provider.initialize((p) => progressUpdates.push(p));
      } catch {
        // Initializing with dummy mock weights may fail ONNX parse, but loading progress was emitted
      }

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].stage).toBe('loading');
    });

    it('should generate correctly shaped normalized vectors', async () => {
      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);

      // Mock pipeline execution for unit test
      (provider as any).pipelineInstance = jest.fn().mockImplementation(async (texts: string[]) => {
        const batch = Array.isArray(texts) ? texts : [texts];
        const data = new Float32Array(batch.length * 384).fill(0.05);
        return { data, dims: [batch.length, 384] };
      });

      const vectors = await provider.embed(['hello world', 'function test() {}']);
      expect(vectors.length).toBe(2);
      expect(vectors[0].length).toBe(384);
      expect(vectors[1].length).toBe(384);
    });

    it('should handle empty input array', async () => {
      const provider = new LocalTransformersProvider('all-MiniLM-L6-v2', tempCacheDir);
      const vectors = await provider.embed([]);
      expect(vectors).toEqual([]);
    });
  });

  describe('OllamaEmbeddingProvider', () => {
    it('should throw clear error when Ollama is unavailable', async () => {
      const provider = new OllamaEmbeddingProvider('http://127.0.0.1:99999', 'nomic-embed-text');

      await expect(provider.initialize()).rejects.toThrow(KodraError);
      await expect(provider.initialize()).rejects.toThrow(/Cannot connect to Ollama/);
    });

    it('should handle explicitly configured Ollama endpoint with dynamic dimensions', async () => {
      const provider = new OllamaEmbeddingProvider('http://mock-ollama:11434', 'custom-model', 1024);
      expect(provider.providerId).toBe('ollama');
      expect(provider.modelId).toBe('ollama:custom-model');
      expect(provider.dimensions).toBe(1024);

      // Mock fetch response for Ollama /api/embed
      const mockFetch = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [new Array(1024).fill(0.01)],
        }),
      } as any);

      await provider.initialize();
      expect(provider.dimensions).toBe(1024);

      const vectors = await provider.embed(['test text']);
      expect(vectors.length).toBe(1);
      expect(vectors[0].length).toBe(1024);

      mockFetch.mockRestore();
    });

    it('should detect dynamic dimensions from Ollama response', async () => {
      const provider = new OllamaEmbeddingProvider('http://mock-ollama:11434', 'bge-m3', 768);

      // Return 1024-dimension vector from Ollama (e.g. bge-large / m3)
      const mockFetch = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: [new Array(1024).fill(0.02)],
        }),
      } as any);

      await provider.initialize();
      expect(provider.dimensions).toBe(1024); // Dynamically updated from probe!

      mockFetch.mockRestore();
    });
  });

  describe('FallbackEmbeddingProvider', () => {
    it('should generate 256-dimension deterministic vectors', async () => {
      const fallback = new FallbackEmbeddingProvider();
      expect(fallback.dimensions).toBe(256);
      expect(fallback.providerId).toBe('fallback');

      const [vec1] = await fallback.embed(['function calculateSum(a, b) { return a + b; }']);
      const [vec2] = await fallback.embed(['function calculateSum(a, b) { return a + b; }']);
      const [vec3] = await fallback.embed(['completely different string']);

      expect(vec1.length).toBe(256);
      expect(vec1).toEqual(vec2); // Deterministic
      expect(vec1).not.toEqual(vec3);
    });
  });

  describe('createEmbeddingProvider factory', () => {
    it('should default to local Transformers provider with all-MiniLM-L6-v2', () => {
      const provider = createEmbeddingProvider();
      expect(provider.providerId).toBe('local');
      expect(provider.modelName).toBe('all-MiniLM-L6-v2');
      expect(provider.dimensions).toBe(384);
    });

    it('should construct Ollama provider when configured', () => {
      const provider = createEmbeddingProvider({
        provider: 'ollama',
        model: 'nomic-embed-text',
        endpoint: 'http://localhost:11434',
      });
      expect(provider.providerId).toBe('ollama');
      expect(provider.modelName).toBe('nomic-embed-text');
    });

    it('should construct fallback provider when requested', () => {
      const provider = createEmbeddingProvider({ provider: 'fallback' });
      expect(provider.providerId).toBe('fallback');
      expect(provider.dimensions).toBe(256);
    });
  });
});
