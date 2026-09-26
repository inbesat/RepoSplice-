import pino, { type Logger, type LoggerOptions } from 'pino';
import { redactPaths } from './redact.js';

// Re-export pino's Logger type so consumers (ai/types.ts ToolContext, etc.)
// can name it without depending on pino directly.
export type { Logger };

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const isPretty =
  !isTest && process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
};

const prettyOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
};

export const logger: Logger = pino(isPretty ? prettyOptions : baseOptions);

export function createJobLogger(jobId: string): Logger {
  return logger.child({ jobId });
}
