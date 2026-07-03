import { Command, InvalidArgumentError } from 'commander';
import type { AppConfig } from '../config/env.js';
import { closePool } from '../db/pool.js';
import { createLogger } from '../log/logger.js';
import { formatStatusText, serializeStatusReport } from '../status/formatStatus.js';
import { StatusService } from '../status/StatusService.js';

interface StatusOptions {
  runId: string;
  json?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidArgumentError('run-id must be a valid UUID');
  }

  return value;
}

export function registerStatusCommand(program: Command, config: AppConfig): void {
  program
    .command('status')
    .description('Show status for a crawl run')
    .requiredOption('--run-id <uuid>', 'Crawl run ID', parseUuid)
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: StatusOptions) => {
      const logger = createLogger(config);
      const statusService = new StatusService();

      try {
        logger.info({
          event: 'status_requested',
          runId: options.runId,
          json: options.json ?? false,
        });

        const report = await statusService.getReport(options.runId);

        if (report === null) {
          logger.info({
            event: 'status_run_not_found',
            runId: options.runId,
          });
          console.error(`Crawl run not found: ${options.runId}`);
          process.exitCode = 1;
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(serializeStatusReport(report), null, 2));
        } else {
          console.log(formatStatusText(report));
        }
      } finally {
        await closePool();
      }
    });
}
