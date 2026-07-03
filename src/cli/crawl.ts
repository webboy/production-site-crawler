import { Command, InvalidArgumentError } from 'commander';
import type { AppConfig } from '../config/env.js';
import { ContentRepository } from '../content/ContentRepository.js';
import { EdgeRepository } from '../content/EdgeRepository.js';
import { HandlerContentProcessor } from '../content/HandlerContentProcessor.js';
import { HandlerRegistry } from '../content/HandlerRegistry.js';
import { HtmlHandler } from '../content/HtmlHandler.js';
import { ImageHandler } from '../content/ImageHandler.js';
import { PdfHandler } from '../content/PdfHandler.js';
import { VideoHandler } from '../content/VideoHandler.js';
import { closePool } from '../db/pool.js';
import { HttpFetchClient } from '../fetch/HttpFetchClient.js';
import { MockFetchClient } from '../fetch/MockFetchClient.js';
import type { FetchClient } from '../fetch/types.js';
import { FrontierRepository } from '../frontier/FrontierRepository.js';
import { createLogger } from '../log/logger.js';
import { CrawlRunService } from '../run/CrawlRunService.js';
import { RunRepository } from '../run/RunRepository.js';
import { OutputStorage } from '../storage/OutputStorage.js';
import { GlobalPauseRateLimiter } from '../worker/RateLimiter.js';
import { BackoffRetryPolicy } from '../worker/RetryPolicy.js';
import { runWorkerPool } from '../worker/WorkerPool.js';

interface CrawlOptions {
  seed?: string;
  resume?: string;
  concurrency: number;
  maxUrls: number;
  maxDepth: number;
  maxBytes: number;
  maxRuntimeSeconds: number;
  outputDir: string;
  mockFetch?: boolean;
}

function parseUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }

    return value;
  } catch {
    throw new InvalidArgumentError('seed must be a valid HTTP or HTTPS URL');
  }
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('value must be a non-negative number');
  }

  return parsed;
}

function parseUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidArgumentError('resume must be a valid UUID run id');
  }

  return value;
}

function createFetchClient(config: AppConfig, options: CrawlOptions): FetchClient {
  if (options.mockFetch) {
    const mockClient = new MockFetchClient();

    if (options.seed !== undefined) {
      mockClient.register(options.seed, {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: Buffer.from('<html><body>mock crawl page</body></html>'),
      });
    }

    return mockClient;
  }

  return new HttpFetchClient({ baseUrl: config.fetchApiBaseUrl });
}

export function registerCrawlCommand(program: Command, config: AppConfig): void {
  program
    .command('crawl')
    .description('Start a crawl from a seed URL')
    .option('--seed <url>', 'Seed URL to crawl', parseUrl)
    .option('--resume <run-id>', 'Resume an existing crawl run', parseUuid)
    .option(
      '--concurrency <number>',
      'Maximum concurrent fetches',
      parseNonNegativeNumber,
      config.crawl.concurrency,
    )
    .option(
      '--max-urls <number>',
      'Maximum URLs to crawl',
      parseNonNegativeNumber,
      config.crawl.maxUrls,
    )
    .option(
      '--max-depth <number>',
      'Maximum crawl depth',
      parseNonNegativeNumber,
      config.crawl.maxDepth,
    )
    .option(
      '--max-bytes <number>',
      'Maximum bytes to persist',
      parseNonNegativeNumber,
      config.crawl.maxBytes,
    )
    .option(
      '--max-runtime-seconds <number>',
      'Maximum crawl runtime in seconds',
      parseNonNegativeNumber,
      config.crawl.maxRuntimeSeconds,
    )
    .option('--output-dir <path>', 'Directory for persisted crawler output', config.crawl.outputDir)
    .option('--mock-fetch', 'Use mock fetch behavior for local development and tests')
    .action(async (options: CrawlOptions) => {
      const logger = createLogger(config);

      if (options.seed === undefined && options.resume === undefined) {
        throw new InvalidArgumentError('Either --seed or --resume is required');
      }

      if (options.seed !== undefined && options.resume !== undefined) {
        throw new InvalidArgumentError('Use either --seed or --resume, not both');
      }

      const runRepository = new RunRepository();
      const frontierRepository = new FrontierRepository();
      const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

      try {
        const run =
          options.resume !== undefined
            ? await crawlRunService.resumeRun(options.resume)
            : await crawlRunService.createRun(options.seed as string, {
                concurrency: options.concurrency,
                maxUrls: options.maxUrls,
                maxDepth: options.maxDepth,
                maxBytes: options.maxBytes,
                maxRuntimeSeconds: options.maxRuntimeSeconds,
              });

        logger.info({
          event: 'run_started',
          runId: run.id,
          seedUrl: run.seedUrl,
          resumed: options.resume !== undefined,
          concurrency: options.concurrency,
          mockFetch: options.mockFetch ?? false,
          outputDir: options.outputDir,
        });

        const rateLimiter = new GlobalPauseRateLimiter({
          baseDelayMs: config.rateLimit.delayMs,
          defaultPauseMs: config.rateLimit.defaultPauseMs,
          logger,
        });

        const edgeRepository = new EdgeRepository();
        const contentProcessor = new HandlerContentProcessor(
          new HandlerRegistry([
            new HtmlHandler(),
            new ImageHandler(),
            new VideoHandler(),
            new PdfHandler(),
          ]),
          new OutputStorage(options.outputDir),
          new ContentRepository(),
        );

        const summary = await runWorkerPool({
          run,
          concurrency: options.concurrency,
          frontier: frontierRepository,
          runRepository,
          crawlRunService,
          fetchClient: createFetchClient(config, options),
          rateLimiter,
          retryPolicy: new BackoffRetryPolicy({
            baseDelayMs: config.retry.baseDelayMs,
            maxDelayMs: config.retry.maxDelayMs,
            jitterRatio: config.retry.jitterRatio,
          }),
          contentProcessor,
          edgeRepository,
          logger,
        });

        logger.info({
          event: 'crawl_summary',
          runId: summary.runId,
          finalStatus: summary.finalStatus,
          statusCounts: summary.statusCounts,
        });

        console.log(
          JSON.stringify(
            {
              runId: summary.runId,
              finalStatus: summary.finalStatus,
              statusCounts: summary.statusCounts,
            },
            null,
            2,
          ),
        );

        if (summary.finalStatus === 'failed') {
          process.exitCode = 1;
        }
      } catch (error) {
        logger.error({
          event: 'crawl_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      } finally {
        await closePool();
      }
    });
}
