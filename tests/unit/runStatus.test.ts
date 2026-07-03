import { describe, expect, it } from 'vitest';
import {
  isFinalRunStatus,
  isResumableRunStatus,
  isTerminalRunStatus,
  type CrawlRunStatus,
} from '../../src/run/types.js';

describe('run status helpers', () => {
  it('treats running and paused as resumable', () => {
    expect(isResumableRunStatus('running')).toBe(true);
    expect(isResumableRunStatus('paused')).toBe(true);
    expect(isResumableRunStatus('limit_reached')).toBe(false);
    expect(isResumableRunStatus('completed')).toBe(false);
  });

  it('treats completed, failed, and cancelled as final', () => {
    const finalStatuses: CrawlRunStatus[] = [
      'completed',
      'completed_with_failures',
      'failed',
      'cancelled',
    ];

    for (const status of finalStatuses) {
      expect(isFinalRunStatus(status)).toBe(true);
      expect(isResumableRunStatus(status)).toBe(false);
    }
  });

  it('keeps deprecated terminal helper aligned with resumable statuses', () => {
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('paused')).toBe(false);
    expect(isTerminalRunStatus('limit_reached')).toBe(false);
    expect(isTerminalRunStatus('completed')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
  });
});
