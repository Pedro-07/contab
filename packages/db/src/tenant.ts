import { runWithLogContext } from '@contab/config/request-context';
import { isUuid, type Role, type TenantId, type UserId } from '@contab/domain';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { getDb, schema, type Db, type Schema } from './internal';

/** Quem está agindo dentro de um tenant. */
export type Actor =
  | { type: 'member'; userId: UserId; role: Role }
  | { type: 'system'; jobName: string; jobId: string };

/** Contexto obrigatório para qualquer acesso a dados de tenant (CLAUDE.md, regra 2). */
export type TenantContext = {
  tenantId: TenantId;
  actor: Actor;
  requestId: string;
  ip?: string | null;
};

declare const tenantTxBrand: unique symbol;
declare const userTxBrand: unique symbol;

type Conn = NodePgDatabase<Schema>;

/** Transação com `app.tenant_id` definido. Só withTenant produz este tipo. */
export type TenantTx = Conn & { readonly [tenantTxBrand]: TenantId };

/** Transação só com `app.user_id`: lista as memberships do próprio usuário. */
export type UserTx = Conn & { readonly [userTxBrand]: UserId };

export class MissingTenantError extends Error {
  constructor() {
    super('Operação sem tenant');
    this.name = 'MissingTenantError';
  }
}

/** Conexão crua de cada transação, para a fila enfileirar dentro dela (ADR 0003). */
const rawClients = new WeakMap<object, pg.PoolClient>();

export function rawClientOf(tx: TenantTx): pg.PoolClient {
  const client = rawClients.get(tx);
  if (!client) throw new Error('Transação inválida');
  return client;
}

async function inTransaction<T>(
  db: Db,
  settings: Record<string, string>,
  fn: (conn: Conn, client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.$client.connect();
  try {
    await client.query('begin');
    for (const [key, value] of Object.entries(settings)) {
      // set_config(..., true) é o SET LOCAL parametrizável: some no fim da transação
      // e não vaza para o próximo uso da conexão no pool.
      await client.query('select set_config($1, $2, true)', [key, value]);
    }
    const conn = drizzle({ client, schema, casing: 'snake_case' });
    rawClients.set(conn, client);
    const result = await fn(conn, client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Abre uma transação no tenant do contexto. Sem tenant válido, falha antes de tocar o banco. */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  if (!ctx || !isUuid(ctx.tenantId)) throw new MissingTenantError();
  const userId = ctx.actor.type === 'member' ? ctx.actor.userId : '';
  return runWithLogContext({ tenantId: ctx.tenantId, requestId: ctx.requestId }, () =>
    inTransaction(db, { 'app.tenant_id': ctx.tenantId, 'app.user_id': userId }, (conn) =>
      fn(conn as TenantTx),
    ),
  );
}

/** Transação com só o usuário no contexto, para ler as próprias memberships. */
export async function withUser<T>(
  userId: UserId,
  fn: (tx: UserTx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  if (!isUuid(userId)) throw new Error('user_id inválido');
  return inTransaction(db, { 'app.user_id': userId }, (conn) => fn(conn as UserTx));
}
