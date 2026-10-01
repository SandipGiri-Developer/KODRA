/**
 * Agent Event Bus for KODRA.
 * 
 * Provides a decoupled event bus for normalized agent execution events:
 * agent lifecycle, tool requests, approvals, execution results, failures.
 */

import { EventEmitter } from 'events';
import { AgentNormalizedEvent } from './types';

export interface IAgentEventBus {
  /**
   * Emit a normalized agent runtime event.
   */
  emit(event: AgentNormalizedEvent): void;

  /**
   * Subscribe to all normalized agent events.
   * Returns an unsubscribe function.
   */
  on(listener: (event: AgentNormalizedEvent) => void): () => void;

  /**
   * Remove all listeners.
   */
  removeAllListeners(): void;
}

export class AgentEventBus implements IAgentEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: AgentNormalizedEvent): void {
    this.emitter.emit('event', event);
  }

  on(listener: (event: AgentNormalizedEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
