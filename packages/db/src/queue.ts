/**
 * Fila de jobs (pg-boss, ADR 0003). Todo job carrega tenantId, e quem enfileira
 * não escolhe o tenant: ele vem do contexto (CLAUDE.md, regra 6).
 */
import { PgBoss, type Db as BossDb } from 'pg-boss';
import { z } from 'zod';
import { rawClientOf, type TenantContext, type TenantTx } from './tenant';

export const PGBOSS_SCHEMA = 'pgboss';

/** Payload mínimo de qualquer job. */
export const tenantJobPayload = z.object({ tenantId: z.uuid() });

/** Catálogo de filas. As filas são criadas na migração (o papel app não cria tabelas). */
export const JOBS = {
  'invitation.send-email': tenantJobPayload.extend({ invitationId: z.uuid() }),
} as const;

export type JobName = keyof typeof JOBS;
export type JobPayload<N extends JobName> = z.infer<(typeof JOBS)[N]>;

export function createBoss(
  connectionString: string,
  options: { supervise?: boolean } = {},
): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    // O schema e as filas são instalados pelo `pnpm db:migrate`, com o papel owner.
    migrate: false,
    createSchema: false,
    supervise: options.supervise ?? false,
    schedule: false,
  });
}

/** Executa o SQL do pg-boss na conexão da transação do tenant. */
function transactionalDb(tx: TenantTx): BossDb {
  const client = rawClientOf(tx);
  return {
    executeSql: async (text, values) => {
      const result = await client.query(text, values as unknown[]);
      return { rows: result.rows };
    },
  };
}

/**
 * Enfileira um job na mesma transação dos dados: se a transação desfizer, o job some junto.
 * O tenantId é sempre o do contexto; o payload passa pelo schema antes de entrar na fila.
 */
export async function enqueue<N extends JobName>(
  boss: PgBoss,
  ctx: TenantContext,
  tx: TenantTx,
  name: N,
  payload: Omit<JobPayload<N>, 'tenantId'>,
): Promise<string | null> {
  const data = JOBS[name].parse({ ...payload, tenantId: ctx.tenantId });
  return boss.send(name, data, { db: transactionalDb(tx), retryLimit: 5, retryBackoff: true });
}
