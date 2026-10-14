import { createFileStorage, type FileStorage } from '@contab/adapters/storage';
import type { TenantContext } from '@contab/db';
import { createDb, type Db } from '@contab/db/testing';
import type { Role, TenantId, UserId } from '@contab/domain';
import { randomUUID } from 'node:crypto';

/** Storage de teste (SeaweedFS do docker compose, bucket de teste do .env.test). */
export function testStorage(): FileStorage {
  return createFileStorage({
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT!,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET!,
    STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID!,
    STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY!,
  });
}

/** Conexão com o papel `app` (sem BYPASSRLS), a mesma da aplicação. */
export function appDb(max = 4): Db {
  return createDb(process.env.DATABASE_URL!, { max });
}

/** Conexão com o papel owner, só para inspecionar efeitos colaterais nos testes. */
export function ownerDb(): Db {
  return createDb(process.env.DATABASE_MIGRATOR_URL!, { max: 2 });
}

export function memberCtx(tenantId: TenantId, userId: UserId, role: Role): TenantContext {
  return {
    tenantId,
    actor: { type: 'member', userId, role },
    requestId: `teste-${randomUUID()}`,
    ip: '127.0.0.1',
  };
}

export function systemCtx(tenantId: TenantId): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'teste', jobId: randomUUID() },
    requestId: `teste-${randomUUID()}`,
  };
}

/** Eventos de segurança gravados para uma requisição (lidos com o papel owner). */
export async function securityEventsFor(owner: Db, requestId: string) {
  const { rows } = await owner.$client.query<{
    type: string;
    resource_type: string | null;
    resource_id: string | null;
  }>('select type, resource_type, resource_id from security_events where request_id = $1', [
    requestId,
  ]);
  return rows;
}

/**
 * Mensagem do erro original do Postgres. O Drizzle embrulha o erro em "Failed query"
 * e guarda o do driver em `cause`; o teste precisa provar o motivo (RLS, FK), não só a falha.
 */
export async function dbErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (err as Error).message;
  }
  throw new Error('esperava que a operação falhasse');
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@exemplo.test`;
}
