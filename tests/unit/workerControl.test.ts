import { describe, expect, it } from 'vitest';
import { createWorkerControl } from '../../src/worker/worker.js';

describe('createWorkerControl', () => {
  it('tracks shutdown and limit flags independently', () => {
    const control = createWorkerControl();

    expect(control.getShutdownRequested()).toBe(false);
    expect(control.getLimitReached()).toBe(false);

    control.requestShutdown();
    expect(control.getShutdownRequested()).toBe(true);
    expect(control.getLimitReached()).toBe(false);

    control.setLimitReached(true);
    expect(control.getLimitReached()).toBe(true);
  });
});
