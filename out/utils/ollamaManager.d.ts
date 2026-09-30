export declare class OllamaManager {
    /**
     * A singleton startup promise. When non-null, Ollama is in the process of being
     * started. All concurrent callers await this same promise to prevent multi-spawn.
     */
    private static startupPromise;
    /**
     * Guards the user-facing warning dialog to ensure it is only shown once at a time.
     */
    private static isPrompting;
    /**
     * Timestamp (ms) of the last successful ping. Used to skip redundant pings within
     * a short window. 30 seconds is long enough to avoid per-message overhead while
     * still detecting restarts quickly.
     */
    private static lastConfirmedAt;
    private static readonly CONFIRMED_TTL_MS;
    /**
     * Silently checks if Ollama is reachable. Does NOT prompt the user.
     * Use this for background tasks (indexing, embeddings) that should not interrupt the user.
     * Results are cached for 30 seconds to avoid repeated pings.
     */
    static isRunning(endpoint?: string): Promise<boolean>;
    /**
     * Ensures Ollama is running, prompting the user to start it if not.
     * Only one user-facing prompt can be shown at a time. If startup is already
     * in progress, all callers await the same singleton promise.
     * Results are cached for 30 seconds to avoid a ping on every message.
     *
     * @returns true if Ollama is running (or was successfully started), false otherwise.
     */
    static ensureRunning(endpoint?: string): Promise<boolean>;
    /**
     * Ping Ollama's root endpoint. Returns true if responsive.
     */
    private static ping;
    /**
     * Spawns 'ollama serve' as a fully detached, hidden background process.
     * Polls until Ollama is reachable or the timeout expires.
     * This method is guaranteed to be called at most once concurrently.
     */
    private static startOllama;
}
//# sourceMappingURL=ollamaManager.d.ts.map