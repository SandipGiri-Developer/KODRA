/**
 * Typed error classes for KODRA.
 * Each error type carries a reason code for structured error handling.
 */

export enum ErrorReason {
  // Provider errors
  ProviderNotConfigured = 'PROVIDER_NOT_CONFIGURED',
  ProviderConnectionFailed = 'PROVIDER_CONNECTION_FAILED',
  ProviderAuthFailed = 'PROVIDER_AUTH_FAILED',
  ProviderRateLimit = 'PROVIDER_RATE_LIMIT',
  ProviderModelNotFound = 'PROVIDER_MODEL_NOT_FOUND',
  ProviderContextLength = 'PROVIDER_CONTEXT_LENGTH',
  ProviderTimeout = 'PROVIDER_TIMEOUT',

  // Indexing errors
  IndexingFailed = 'INDEXING_FAILED',
  IndexCorrupted = 'INDEX_CORRUPTED',
  EmbeddingFailed = 'EMBEDDING_FAILED',
  FileReadFailed = 'FILE_READ_FAILED',
  FileTooLarge = 'FILE_TOO_LARGE',

  // Agent errors
  AgentIterationLimit = 'AGENT_ITERATION_LIMIT',
  ToolExecutionFailed = 'TOOL_EXECUTION_FAILED',
  ToolNotFound = 'TOOL_NOT_FOUND',
  ToolValidationFailed = 'TOOL_VALIDATION_FAILED',

  // Security errors
  PathTraversal = 'PATH_TRAVERSAL',
  FileSecurityConcern = 'FILE_SECURITY_CONCERN',
  OutsideWorkspace = 'OUTSIDE_WORKSPACE',

  // General
  Cancelled = 'CANCELLED',
  ConfigInvalid = 'CONFIG_INVALID',
  Unknown = 'UNKNOWN',
}

export class KodraError extends Error {
  constructor(
    public readonly reason: ErrorReason,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'KodraError';
  }

  /**
   * Returns a user-friendly message that doesn't expose internal details.
   */
  get userMessage(): string {
    switch (this.reason) {
      case ErrorReason.ProviderNotConfigured:
        return 'No AI provider configured. Open Kodra settings to set up a provider.';
      case ErrorReason.ProviderConnectionFailed:
        return 'Could not connect to the AI provider. Check your network and endpoint settings.';
      case ErrorReason.ProviderAuthFailed:
        return 'Authentication failed. Check your API key in Kodra settings.';
      case ErrorReason.ProviderRateLimit:
        return 'Rate limit exceeded. Please wait a moment and try again.';
      case ErrorReason.ProviderModelNotFound:
        return 'The specified model was not found. Check your model name in settings.';
      case ErrorReason.ProviderContextLength:
        return 'The request exceeded the model\'s context length. Try a shorter message or fewer context files.';
      case ErrorReason.ProviderTimeout:
        return 'Request timed out. The model may be loading or unavailable.';
      case ErrorReason.Cancelled:
        return 'Request was cancelled.';
      case ErrorReason.PathTraversal:
      case ErrorReason.OutsideWorkspace:
        return 'Access denied: the requested path is outside the workspace.';
      case ErrorReason.FileSecurityConcern:
        return 'This file is excluded for security reasons (e.g., secrets, keys, credentials).';
      default:
        return this.message;
    }
  }
}

/**
 * Type guard to check if an error is an abort/cancellation error.
 */
export function isCancellationError(error: unknown): boolean {
  if (error instanceof KodraError && error.reason === ErrorReason.Cancelled) {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return false;
}

/**
 * Wraps an unknown thrown value into an Error object.
 */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  if (typeof thrown === 'string') {
    return new Error(thrown);
  }
  return new Error(String(thrown));
}
