/**
 * Typed error classes for KODRA.
 * Each error type carries a reason code for structured error handling.
 */
export declare enum ErrorReason {
    ProviderNotConfigured = "PROVIDER_NOT_CONFIGURED",
    ProviderConnectionFailed = "PROVIDER_CONNECTION_FAILED",
    ProviderAuthFailed = "PROVIDER_AUTH_FAILED",
    ProviderRateLimit = "PROVIDER_RATE_LIMIT",
    ProviderModelNotFound = "PROVIDER_MODEL_NOT_FOUND",
    ProviderContextLength = "PROVIDER_CONTEXT_LENGTH",
    ProviderTimeout = "PROVIDER_TIMEOUT",
    IndexingFailed = "INDEXING_FAILED",
    IndexCorrupted = "INDEX_CORRUPTED",
    EmbeddingFailed = "EMBEDDING_FAILED",
    FileReadFailed = "FILE_READ_FAILED",
    FileTooLarge = "FILE_TOO_LARGE",
    AgentIterationLimit = "AGENT_ITERATION_LIMIT",
    ToolExecutionFailed = "TOOL_EXECUTION_FAILED",
    ToolNotFound = "TOOL_NOT_FOUND",
    ToolValidationFailed = "TOOL_VALIDATION_FAILED",
    PathTraversal = "PATH_TRAVERSAL",
    FileSecurityConcern = "FILE_SECURITY_CONCERN",
    OutsideWorkspace = "OUTSIDE_WORKSPACE",
    Cancelled = "CANCELLED",
    ConfigInvalid = "CONFIG_INVALID",
    Unknown = "UNKNOWN"
}
export declare class KodraError extends Error {
    readonly reason: ErrorReason;
    readonly cause?: Error | undefined;
    constructor(reason: ErrorReason, message: string, cause?: Error | undefined);
    /**
     * Returns a user-friendly message that doesn't expose internal details.
     */
    get userMessage(): string;
}
/**
 * Type guard to check if an error is an abort/cancellation error.
 */
export declare function isCancellationError(error: unknown): boolean;
/**
 * Wraps an unknown thrown value into an Error object.
 */
export declare function toError(thrown: unknown): Error;
//# sourceMappingURL=errors.d.ts.map