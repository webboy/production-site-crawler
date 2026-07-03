import { Command, InvalidArgumentError } from 'commander';
import type { AppConfig } from '../config/env.js';
import { createLogger } from '../log/logger.js';

interface CrawlOptions {
  seed: string;
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

export function registerCrawlCommand(program: Command, config: AppConfig): void {
  program
    .command('crawl')
    .description('Start a crawl from a seed URL')
    .requiredOption('--seed <url>', 'Seed URL to crawl', parseUrl)
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
    .option('--mock-fetch', 'Use mock fetch behavior when later phases add fetching')
    .action((options: CrawlOptions) => {
      const logger = createLogger(config);

      logger.info({
        event: 'not_implemented',
        command: 'crawl',
        seed: options.seed,
        concurrency: options.concurrency,
        maxUrls: options.maxUrls,
        maxDepth: options.maxDepth,
        maxBytes: options.maxBytes,
        maxRuntimeSeconds: options.maxRuntimeSeconds,
        outputDir: options.outputDir,
        mockFetch: options.mockFetch ?? false,
      });
    });
}
