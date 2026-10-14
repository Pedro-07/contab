import { AsyncLocalStorage } from 'node:async_hooks';

/** Campos que acompanham toda linha de log (plano, seção 13). Nunca conteúdo. */
export type LogContext = {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  jobId?: string;
  jobName?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...context }, fn);
}

export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}
