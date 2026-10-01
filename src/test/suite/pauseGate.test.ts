import { PauseGate } from '../../utils/pauseGate';

describe('PauseGate', () => {
  let gate: PauseGate;

  beforeEach(() => {
    gate = new PauseGate();
  });

  test('initial state is not paused', () => {
    expect(gate.isPaused).toBe(false);
  });

  test('wait() resolves immediately when not paused', async () => {
    const start = Date.now();
    await gate.wait();
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('wait() blocks when paused until resume() is called', async () => {
    gate.pause();
    expect(gate.isPaused).toBe(true);

    let resolved = false;
    const waitPromise = gate.wait().then(() => {
      resolved = true;
    });

    // Check that it's still waiting
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);

    // Resume gate
    gate.resume();
    expect(gate.isPaused).toBe(false);

    await waitPromise;
    expect(resolved).toBe(true);
  });

  test('setPaused(true) and setPaused(false) work correctly', async () => {
    gate.setPaused(true);
    expect(gate.isPaused).toBe(true);

    let waitFinished = false;
    gate.wait().then(() => {
      waitFinished = true;
    });

    await new Promise((r) => setImmediate(r));
    expect(waitFinished).toBe(false);

    gate.setPaused(false);
    expect(gate.isPaused).toBe(false);

    await new Promise((r) => setImmediate(r));
    expect(waitFinished).toBe(true);
  });

  test('wait() unblocks immediately when AbortSignal fires', async () => {
    gate.pause();
    const controller = new AbortController();

    let resolved = false;
    const waitPromise = gate.wait(controller.signal).then(() => {
      resolved = true;
    });

    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);

    controller.abort();
    await waitPromise;
    expect(resolved).toBe(true);
    // Gate should still remain paused for other callers
    expect(gate.isPaused).toBe(true);
  });

  test('wait() resolves immediately if AbortSignal is already aborted', async () => {
    gate.pause();
    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    await gate.wait(controller.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('multiple concurrent callers all resume when resume() is called', async () => {
    gate.pause();
    let count = 0;

    const p1 = gate.wait().then(() => { count++; });
    const p2 = gate.wait().then(() => { count++; });
    const p3 = gate.wait().then(() => { count++; });

    await new Promise((r) => setImmediate(r));
    expect(count).toBe(0);

    gate.resume();
    await Promise.all([p1, p2, p3]);
    expect(count).toBe(3);
  });
});
