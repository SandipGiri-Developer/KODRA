// Unit tests for webview time formatting utilities and session activity state transitions.
import { describe, it, expect } from 'vitest';
import { formatDuration } from '../util/time';
import sessionReducer, {
  finalizeAgentActivity,
  setInactive,
  addAgentActivityToLatestAssistant
} from '../redux/slices/sessionSlice';

describe('Webview time formatter & session activity state', () => {
  describe('formatDuration unit tests', () => {
    it('formats exact specified intervals correctly', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(1)).toBe('1s');
      expect(formatDuration(59)).toBe('59s');
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(61)).toBe('1m 1s');
      expect(formatDuration(83)).toBe('1m 23s');
      expect(formatDuration(439)).toBe('7m 19s');
      expect(formatDuration(3599)).toBe('59m 59s');
      expect(formatDuration(3600)).toBe('1h 0m 0s');
      expect(formatDuration(3661)).toBe('1h 1m 1s');
    });

    it('handles negative, non-number and NaN values safely', () => {
      expect(formatDuration(-10)).toBe('0s');
      expect(formatDuration(NaN)).toBe('0s');
      expect(formatDuration(undefined as any)).toBe('0s');
      expect(formatDuration(null as any)).toBe('0s');
    });
  });

  describe('Redux sessionSlice activity finalization', () => {
    const createInitialState = () => ({
      history: [
        {
          message: { role: 'user' as const, content: 'User question' },
        },
        {
          message: { role: 'assistant' as const, content: 'Thinking...' },
          agentActivities: [
            {
              type: 'started' as const,
              executionId: 'exec-1',
              timestamp: Date.now() - 10000,
            },
            {
              type: 'step' as const,
              executionId: 'exec-1',
              timestamp: Date.now() - 5000,
              description: 'Searching workspace',
            },
          ] as any[],
        },
      ],
      isStreaming: true,
      activeExecutionId: 'exec-1',
    });

    it('finalizes dangling started activity on finalizeAgentActivity(completed)', () => {
      const state = createInitialState();
      const updated = sessionReducer(state as any, finalizeAgentActivity({ status: 'completed' }));
      const activities = updated.history[1].agentActivities!;
      const last = activities[activities.length - 1];
      expect(last.event?.kind || last.type).toBe('completed');
    });

    it('finalizes dangling started activity on finalizeAgentActivity(failed)', () => {
      const state = createInitialState();
      const updated = sessionReducer(state as any, finalizeAgentActivity({ status: 'failed', error: 'Network broken' }));
      const activities = updated.history[1].agentActivities!;
      const last = activities[activities.length - 1];
      expect(last.event?.kind || last.type).toBe('failed');
      expect(last.event?.error || last.error).toBe('Network broken');
    });

    it('finalizes dangling started activity on finalizeAgentActivity(cancelled)', () => {
      const state = createInitialState();
      const updated = sessionReducer(state as any, finalizeAgentActivity({ status: 'cancelled' }));
      const activities = updated.history[1].agentActivities!;
      const last = activities[activities.length - 1];
      expect(last.event?.kind || last.type).toBe('cancelled');
    });

    it('does not duplicate terminal event if already finalized', () => {
      const state = createInitialState();
      state.history[1].agentActivities!.push({
        executionId: 'exec-1',
        event: {
          kind: 'completed',
          timestamp: Date.now(),
        },
      });

      const updated = sessionReducer(state as any, finalizeAgentActivity({ status: 'completed' }));
      const activities = updated.history[1].agentActivities!;
      expect(activities.filter(a => (a.event?.kind || a.type) === 'completed')).toHaveLength(1);
    });

    it('setInactive forces finalization and clears isStreaming', () => {
      const state = createInitialState();
      const updated = sessionReducer(state as any, setInactive());
      expect(updated.isStreaming).toBe(false);
      const activities = updated.history[1].agentActivities!;
      const last = activities[activities.length - 1];
      expect(last.event?.kind || last.type).toBe('completed');
    });

    it('adds late arriving agentActivity to latest assistant message', () => {
      const state = createInitialState();
      const updated = sessionReducer(
        state as any,
        addAgentActivityToLatestAssistant({
          type: 'tool_call',
          executionId: 'exec-1',
          timestamp: Date.now(),
          toolName: 'read_file',
        })
      );
      const activities = updated.history[1].agentActivities!;
      expect(activities).toHaveLength(3);
      expect((activities[2] as any).toolName).toBe('read_file');
    });
  });
});
