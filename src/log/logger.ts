import pino from 'pino';
import type { AppConfig } from '../config/env.js';

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): pino.Logger {
  const usePrettyLogs = config.nodeEnv !== 'production';

  return pino({
    level: config.logLevel,
    ...(usePrettyLogs
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}
