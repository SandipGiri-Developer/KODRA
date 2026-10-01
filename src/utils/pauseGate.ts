/**
 * PauseGate — Deterministic synchronization primitive for pausing and resuming async tasks.
 * 
 * Replaces busy-wait polling loops and arbitrary setTimeout delays with event-driven Promise signaling.
 */
export class PauseGate {
  private _isPaused = false;
  private _resumePromise: Promise<void> | null = null;
  private _resumeResolve: (() => void) | null = null;

  /**
   * Returns true if the gate is currently in a paused state.
   */
  public get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Pauses the gate. Subsequent calls to wait() will block until resume() is called.
   */
  public pause(): void {
    if (this._isPaused) {
      return;
    }
    this._isPaused = true;
    this._resumePromise = new Promise<void>((resolve) => {
      this._resumeResolve = resolve;
    });
  }

  /**
   * Resumes the gate, immediately unblocking any callers waiting on wait().
   */
  public resume(): void {
    if (!this._isPaused) {
      return;
    }
    this._isPaused = false;
    if (this._resumeResolve) {
      const resolve = this._resumeResolve;
      this._resumeResolve = null;
      this._resumePromise = null;
      resolve();
    }
  }

  /**
   * Sets paused state explicitly.
   */
  public setPaused(paused: boolean): void {
    if (paused) {
      this.pause();
    } else {
      this.resume();
    }
  }

  /**
   * Waits if the gate is paused. Resolves immediately if the gate is not paused.
   * If an AbortSignal is provided and becomes aborted, wait() unblocks immediately.
   */
  public async wait(signal?: AbortSignal): Promise<void> {
    if (!this._isPaused || !this._resumePromise) {
      return;
    }

    if (signal?.aborted) {
      return;
    }

    if (!signal) {
      await this._resumePromise;
      return;
    }

    await new Promise<void>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };

      signal.addEventListener('abort', onAbort, { once: true });

      this._resumePromise?.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  /**
   * Resets the gate to unpaused state and clears any pending promises.
   */
  public reset(): void {
    this.resume();
  }
}
