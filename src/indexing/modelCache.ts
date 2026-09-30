/**
 * Model Cache Manager for KODRA.
 * 
 * Manages downloading, local caching, integrity verification,
 * and offline detection for local Transformers.js embedding models.
 * 
 * Rules:
 * - Never store model files inside user projects
 * - Never hardcode machine-specific paths
 * - Support offline mode gracefully when cached
 * - Detect and clean up corrupted/interrupted downloads
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../utils/logger';

export interface ModelCacheStatus {
  isCached: boolean;
  modelPath: string;
  filesPresent: string[];
  totalSizeBytes: number;
}

export class ModelCacheManager {
  private static defaultCacheRoot: string | null = null;

  /**
   * Set global extension storage path (from VS Code ExtensionContext.globalStorageUri.fsPath).
   */
  static setGlobalStoragePath(storagePath: string): void {
    ModelCacheManager.defaultCacheRoot = path.join(storagePath, 'models');
  }

  /**
   * Get the root directory for cached models.
   * Order of precedence:
   * 1. Explicitly provided override
   * 2. VS Code global storage path (if set)
   * 3. ~/.KODRA/models in user's home directory
   */
  static getCacheDir(overrideDir?: string): string {
    if (overrideDir) {
      return path.resolve(overrideDir);
    }
    if (ModelCacheManager.defaultCacheRoot) {
      return ModelCacheManager.defaultCacheRoot;
    }
    return path.join(os.homedir(), '.KODRA', 'models');
  }

  /**
   * Get the directory for a specific model.
   * e.g., 'all-MiniLM-L6-v2' -> '<cacheDir>/Xenova/all-MiniLM-L6-v2' or '<cacheDir>/all-MiniLM-L6-v2'
   */
  static getModelDir(modelName: string, overrideDir?: string): string {
    const cacheRoot = ModelCacheManager.getCacheDir(overrideDir);
    // HuggingFace / Transformers.js stores models under either <org>/<model> or directly <model>
    const normalizedName = modelName.startsWith('Xenova/') ? modelName : `Xenova/${modelName}`;
    return path.join(cacheRoot, ...normalizedName.split('/'));
  }

  /**
   * Check if a model is fully cached with valid weights and tokenizer.
   */
  static async isModelCached(modelName: string, overrideDir?: string): Promise<boolean> {
    const status = await ModelCacheManager.checkModelCache(modelName, overrideDir);
    return status.isCached;
  }

  /**
   * Detailed check of model files in the cache.
   */
  static async checkModelCache(modelName: string, overrideDir?: string): Promise<ModelCacheStatus> {
    const modelDir = ModelCacheManager.getModelDir(modelName, overrideDir);
    const filesPresent: string[] = [];
    let totalSizeBytes = 0;

    try {
      await fs.access(modelDir);
    } catch {
      // Check alternative directory without Xenova prefix
      const altDir = path.join(ModelCacheManager.getCacheDir(overrideDir), modelName);
      try {
        await fs.access(altDir);
        return ModelCacheManager.inspectDir(altDir);
      } catch {
        return { isCached: false, modelPath: modelDir, filesPresent: [], totalSizeBytes: 0 };
      }
    }

    return ModelCacheManager.inspectDir(modelDir);
  }

  private static async inspectDir(dir: string): Promise<ModelCacheStatus> {
    const filesPresent: string[] = [];
    let totalSizeBytes = 0;

    const checkFile = async (relPath: string): Promise<boolean> => {
      try {
        const full = path.join(dir, relPath);
        const stat = await fs.stat(full);
        if (stat.isFile() && stat.size > 0) {
          filesPresent.push(relPath);
          totalSizeBytes += stat.size;
          return true;
        }
      } catch {
        // file doesn't exist
      }
      return false;
    };

    const hasConfig = await checkFile('config.json');
    const hasTokenizer = (await checkFile('tokenizer.json')) || (await checkFile('tokenizer_config.json'));
    
    // Check ONNX model file (either quantized or unquantized)
    const hasOnnx =
      (await checkFile(path.join('onnx', 'model_quantized.onnx'))) ||
      (await checkFile(path.join('onnx', 'model.onnx'))) ||
      (await checkFile('model_quantized.onnx')) ||
      (await checkFile('model.onnx'));

    // A model is considered fully cached if it has config, tokenizer, and an ONNX weight file
    const isCached = hasConfig && hasTokenizer && hasOnnx;

    return {
      isCached,
      modelPath: dir,
      filesPresent,
      totalSizeBytes,
    };
  }

  /**
   * Remove corrupted or incomplete model files from cache.
   */
  static async clearModelCache(modelName: string, overrideDir?: string): Promise<void> {
    const logger = Logger.getInstance();
    const modelDir = ModelCacheManager.getModelDir(modelName, overrideDir);
    try {
      if (fsSync.existsSync(modelDir)) {
        await fs.rm(modelDir, { recursive: true, force: true });
        logger.info(`Cleared model cache at ${modelDir}`);
      }
    } catch (e) {
      logger.warn(`Failed to clear model cache at ${modelDir}`, e);
    }
  }

  /**
   * Fast check to see if the network is available for downloading models.
   */
  static async isOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      // Quick fetch to HuggingFace or a reliable endpoint
      const response = await fetch('https://huggingface.co', {
        method: 'HEAD',
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      return response !== null && (response.ok || response.status < 500);
    } catch {
      return false;
    }
  }
}
