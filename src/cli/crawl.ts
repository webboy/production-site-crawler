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
import type { BodyDecodeStrategy } from '../fetch/body.js';
import { HttpFetchClient } from '../fetch/HttpFetchClient.js';
import { MockFetchClient } from '../fetch/MockFetchClient.js';
import type { FetchClient } from '../fetch/types.js';
import { FrontierRepository } from '../frontier/FrontierRepository.js';
import { createLogger } from '../log/logger.js';
import { CrawlRunService } from '../run/CrawlRunService.js';
import { RunRepository } from '../run/RunRepository.js';
import { OutputStorage } from '../storage/OutputStorage.js';
import { formatStatusText } from '../status/formatStatus.js';
import { StatusService } from '../status/StatusService.js';
import { GlobalPauseRateLimiter } from '../worker/RateLimiter.js';
import { BackoffRetryPolicy } from '../worker/RetryPolicy.js';
import { runWorkerPool } from '../worker/WorkerPool.js';

interface CrawlOptions {
  seed?: string;
  resume?: string;
  concurrency?: number;
  maxUrls?: number;
  maxDepth?: number;
  maxBytes?: number;
  maxRuntimeSeconds?: number;
  outputDir?: string;
  mockFetch?: boolean;
  bodyStrategy?: BodyDecodeStrategy;
}

function isCliOption(command: Command, optionName: string): boolean {
  return command.getOptionValueSource(optionName) === 'cli';
}

function resolveLimit(value: number | undefined, fallback: number): number | null {
  return value === 0 ? null : (value ?? fallback);
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

function parseBodyStrategy(value: string): BodyDecodeStrategy {
  if (value === 'auto' || value === 'base64' || value === 'utf8') {
    return value;
  }

  throw new InvalidArgumentError('body-strategy must be auto, base64, or utf8');
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

  return new HttpFetchClient({
    baseUrl: config.fetchApiBaseUrl,
    bodyStrategy: options.bodyStrategy ?? config.fetchBodyStrategy,
  });
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
    .option(
      '--body-strategy <strategy>',
      'How to decode the Fetch API body: auto | base64 | utf8',
      parseBodyStrategy,
      config.fetchBodyStrategy,
    )
    .action(async (options: CrawlOptions, command: Command) => {
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
        let run;
        let resumeResult;

        if (options.resume !== undefined) {
          resumeResult = await crawlRunService.resumeRun(options.resume, {
            overrides: {
              concurrency: options.concurrency,
              maxUrls:
                options.maxUrls === undefined
                  ? undefined
                  : resolveLimit(options.maxUrls, config.crawl.maxUrls),
              maxDepth:
                options.maxDepth === undefined
                  ? undefined
                  : resolveLimit(options.maxDepth, config.crawl.maxDepth),
              maxBytes:
                options.maxBytes === undefined
                  ? undefined
                  : resolveLimit(options.maxBytes, config.crawl.maxBytes),
              maxRuntimeSeconds:
                options.maxRuntimeSeconds === undefined
                  ? undefined
                  : resolveLimit(options.maxRuntimeSeconds, config.crawl.maxRuntimeSeconds),
              outputDir: options.outputDir,
            },
            explicit: {
              concurrency: isCliOption(command, 'concurrency'),
              maxUrls: isCliOption(command, 'maxUrls'),
              maxDepth: isCliOption(command, 'maxDepth'),
              maxBytes: isCliOption(command, 'maxBytes'),
              maxRuntimeSeconds: isCliOption(command, 'maxRuntimeSeconds'),
              outputDir: isCliOption(command, 'outputDir'),
            },
          });
          run = resumeResult.run;

          logger.info({
            event: 'run_resumed',
            runId: run.id,
            seedUrl: run.seedUrl,
            previousStatus: resumeResult.previousStatus,
            recoveredInProgressCount: resumeResult.recoveredInProgressCount,
            concurrency: run.concurrency,
            outputDir: run.outputDir,
            maxUrls: run.maxUrls,
            maxDepth: run.maxDepth,
            maxBytes: run.maxBytes,
            maxRuntimeSeconds: run.maxRuntimeSeconds,
            mockFetch: options.mockFetch ?? false,
          });
        } else {
          run = await crawlRunService.createRun(options.seed as string, {
            concurrency: options.concurrency ?? config.crawl.concurrency,
            maxUrls: resolveLimit(options.maxUrls, config.crawl.maxUrls),
            maxDepth: resolveLimit(options.maxDepth, config.crawl.maxDepth),
            maxBytes: resolveLimit(options.maxBytes, config.crawl.maxBytes),
            maxRuntimeSeconds: resolveLimit(
              options.maxRuntimeSeconds,
              config.crawl.maxRuntimeSeconds,
            ),
            outputDir: options.outputDir ?? config.crawl.outputDir,
          });

          logger.info({
            event: 'run_started',
            runId: run.id,
            seedUrl: run.seedUrl,
            concurrency: run.concurrency,
            outputDir: run.outputDir,
            maxUrls: run.maxUrls,
            maxDepth: run.maxDepth,
            maxBytes: run.maxBytes,
            maxRuntimeSeconds: run.maxRuntimeSeconds,
            mockFetch: options.mockFetch ?? false,
          });
        }

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
          new OutputStorage(run.outputDir),
          new ContentRepository(),
        );

        const summary = await runWorkerPool({
          run,
          concurrency: run.concurrency,
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

        const statusService = new StatusService(
          runRepository,
          frontierRepository,
          new ContentRepository(),
        );
        const report = await statusService.getReport(summary.runId);

        logger.info({
          event: 'crawl_summary',
          runId: summary.runId,
          finalStatus: summary.finalStatus,
          statusCounts: summary.statusCounts,
          bytesDownloaded: report?.bytesDownloaded ?? run.totalBytes,
        });

        if (report !== null) {
          console.log(formatStatusText(report));
        }

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
