import { describe, expect, it, vi } from 'vitest';
import { withOutcomeMarkRetry } from '../../src/worker/outcomeMarkRetry.js';

describe('withOutcomeMarkRetry', () => {
  it('succeeds on the second attempt', async () => {
    let calls = 0;

    await withOutcomeMarkRetry(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error('transient');
        }
      },
      () => {},
      3,
    );

    expect(calls).toBe(2);
  });

  it('throws after max attempts', async () => {
    const operation = vi.fn(async () => {
      throw new Error('persistent');
    });

    await expect(
      withOutcomeMarkRetry(operation, () => {}, 2),
    ).rejects.toThrow('persistent');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
