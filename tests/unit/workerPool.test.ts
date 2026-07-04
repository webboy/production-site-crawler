import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FinalizeRunContext, FinalizeRunResult } from '../../src/run/CrawlRunService.js';
import type { CrawlRun } from '../../src/run/types.js';
import { createWorkerControl } from '../../src/worker/worker.js';
import { runWorkerPool } from '../../src/worker/WorkerPool.js';

function createLogCapture() {
  const entries: unknown[] = [];
  const logger = pino({
    level: 'info',
    hooks: {
      logMethod(inputArgs, method) {
        entries.push(inputArgs[0]);
        method.apply(this, inputArgs);
      },
    },
  });

  return { logger, entries };
}

function createRun(overrides: Partial<CrawlRun> = {}): CrawlRun {
  return {
    id: 'run-1',
    seedUrl: 'https://example.com',
    normalizedSeedUrl: 'https://example.com',
    scopeHost: 'example.com',
    scopePolicy: 'same_host',
    status: 'running',
    maxUrls: null,
    maxDepth: null,
    maxBytes: null,
    maxRuntimeSeconds: null,
    concurrency: 1,
    outputDir: '/tmp/out',
    totalBytes: 0,
    urlsEnqueued: 1,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createStatusCounts() {
  return {
    queued: 0,
    in_progress: 0,
    done: 1,
    retryable_failed: 0,
    permanent_failed: 0,
    blocked: 0,
    skipped_unsupported: 0,
    redirected: 0,
  };
}

function createPoolOptions(overrides: {
  run?: CrawlRun;
  logger?: ReturnType<typeof createLogCapture>['logger'];
  control?: ReturnType<typeof createWorkerControl>;
  workerRunner?: ReturnType<typeof vi.fn>;
  finalizeRun?: ReturnType<typeof vi.fn>;
  finish?: ReturnType<typeof vi.fn>;
}) {
  const finalizeRun =
    overrides.finalizeRun ??
    vi.fn(
      async (_runId: string, _context: FinalizeRunContext = {}): Promise<FinalizeRunResult> => ({
        finalStatus: 'completed',
        statusCounts: createStatusCounts(),
      }),
    );

  const finish = overrides.finish ?? vi.fn(async () => undefined);

  return {
    options: {
      run: overrides.run ?? createRun(),
      concurrency: 1,
      frontier: {} as never,
      runRepository: { finish } as never,
      crawlRunService: { finalizeRun } as never,
      fetchClient: {} as never,
      rateLimiter: {} as never,
      retryPolicy: {} as never,
      contentProcessor: {} as never,
      edgeRepository: {} as never,
      logger: overrides.logger ?? createLogCapture().logger,
      registerSignalHandlers: false,
      control: overrides.control,
      workerRunner: overrides.workerRunner,
    },
    finalizeRun,
    finish,
  };
}

describe('runWorkerPool', () => {
  it('returns a completed summary on the happy path', async () => {
    const statusCounts = createStatusCounts();
    const { options, finalizeRun } = createPoolOptions({
      workerRunner: vi.fn(async () => ({
        hadInfraFailure: false,
        hadWorkerCrash: false,
      })),
      finalizeRun: vi.fn(async () => ({
        finalStatus: 'completed' as const,
        statusCounts,
      })),
    });
    const { logger, entries } = createLogCapture();
    options.logger = logger;

    const summary = await runWorkerPool(options);

    expect(finalizeRun).toHaveBeenCalledWith('run-1', {
      limitReached: false,
      shutdownRequested: false,
      infraFailure: false,
    });
    expect(summary).toEqual({
      runId: 'run-1',
      finalStatus: 'completed',
      statusCounts,
      shutdownRequested: false,
      limitReached: false,
    });
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'run_completed',
        runId: 'run-1',
        finalStatus: 'completed',
        statusCounts,
      }),
    );
  });

  it('finalizes as failed when the worker runner reports infra failure', async () => {
    const { options, finalizeRun } = createPoolOptions({
      workerRunner: vi.fn(async () => ({
        hadInfraFailure: true,
        hadWorkerCrash: false,
      })),
      finalizeRun: vi.fn(async () => ({
        finalStatus: 'failed' as const,
        statusCounts: createStatusCounts(),
      })),
    });
    const { logger, entries } = createLogCapture();
    options.logger = logger;

    const summary = await runWorkerPool(options);

    expect(finalizeRun).toHaveBeenCalledWith('run-1', {
      limitReached: false,
      shutdownRequested: false,
      infraFailure: true,
    });
    expect(summary.finalStatus).toBe('failed');
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'run_failed',
        runId: 'run-1',
        finalStatus: 'failed',
      }),
    );
  });

  it('logs the root cause and finalizes as failed when the worker runner throws', async () => {
    const { options, finalizeRun } = createPoolOptions({
      workerRunner: vi.fn(async () => {
        throw new Error('pool runner exploded');
      }),
      finalizeRun: vi.fn(async () => ({
        finalStatus: 'failed' as const,
        statusCounts: createStatusCounts(),
      })),
    });
    const { logger, entries } = createLogCapture();
    options.logger = logger;

    const summary = await runWorkerPool(options);

    expect(finalizeRun).toHaveBeenCalledWith('run-1', {
      limitReached: false,
      shutdownRequested: false,
      infraFailure: true,
    });
    expect(summary.finalStatus).toBe('failed');
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'worker_crashed',
        runId: 'run-1',
        cause: 'pool runner exploded',
      }),
    );
  });

  it('falls back to finish(failed) when finalizeRun throws', async () => {
    const { options, finalizeRun, finish } = createPoolOptions({
      workerRunner: vi.fn(async () => ({
        hadInfraFailure: false,
        hadWorkerCrash: false,
      })),
      finalizeRun: vi.fn(async () => {
        throw new Error('finalize unavailable');
      }),
    });
    const { logger, entries } = createLogCapture();
    options.logger = logger;

    const summary = await runWorkerPool(options);

    expect(finalizeRun).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith('run-1', 'failed');
    expect(summary).toEqual({
      runId: 'run-1',
      finalStatus: 'failed',
      statusCounts: {
        queued: 0,
        in_progress: 0,
        done: 0,
        retryable_failed: 0,
        permanent_failed: 0,
        blocked: 0,
        skipped_unsupported: 0,
        redirected: 0,
      },
      shutdownRequested: false,
      limitReached: false,
    });
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'run_failed',
        runId: 'run-1',
        finalStatus: 'failed',
        cause: 'finalize unavailable',
      }),
    );
  });

  it('passes shutdown and limit flags from control into finalizeRun', async () => {
    const control = createWorkerControl();
    control.requestShutdown();
    control.setLimitReached(true);

    const { options, finalizeRun } = createPoolOptions({
      control,
      workerRunner: vi.fn(async () => ({
        hadInfraFailure: false,
        hadWorkerCrash: false,
      })),
    });

    const summary = await runWorkerPool(options);

    expect(finalizeRun).toHaveBeenCalledWith('run-1', {
      limitReached: true,
      shutdownRequested: true,
      infraFailure: false,
    });
    expect(summary.shutdownRequested).toBe(true);
    expect(summary.limitReached).toBe(true);
  });
});
