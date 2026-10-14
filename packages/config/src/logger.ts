import pino, { type DestinationStream, type Logger } from 'pino';
import { currentLogContext } from './request-context';

/**
 * Chaves que nunca podem sair em log, mesmo por engano (CLAUDE.md, regra 9).
 * O redact troca o valor por "[removido]".
 */
export const REDACTED_PATHS = [
  'token',
  '*.token',
  'url',
  '*.url',
  'secret',
  '*.secret',
  'password',
  '*.password',
  'code',
  '*.code',
  'backupCodes',
  '*.backupCodes',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'headers.authorization',
];

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? 'info',
      base: undefined,
      redact: { paths: REDACTED_PATHS, censor: '[removido]' },
      // tenant_id, request_id, user_id e job_id em toda linha.
      mixin() {
        const ctx = currentLogContext();
        return {
          request_id: ctx.requestId,
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          job_id: ctx.jobId,
          job_name: ctx.jobName,
        };
      },
    },
    options.destination,
  );
}

export const logger = createLogger();
