import { Command, InvalidArgumentError } from 'commander';
import type { AppConfig } from '../config/env.js';
import { createLogger } from '../log/logger.js';

interface StatusOptions {
  runId: string;
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
    .action((options: StatusOptions) => {
      const logger = createLogger(config);

      logger.info({
        event: 'not_implemented',
        command: 'status',
        runId: options.runId,
      });
    });
}
