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
  // Confere tamanho, tipo pelo conteúdo e hash do arquivo enviado (incremento 2).
  'document.verify': tenantJobPayload.extend({ versionId: z.uuid() }),
  // Entrega e régua (incremento 3).
  'delivery.plan': tenantJobPayload.extend({
    itemType: z.enum(['guia', 'documento']),
    itemId: z.uuid(),
    trigger: z.enum(['publicacao', 'lembrete', 'vencida', 'pago']),
  }),
  'delivery.send': tenantJobPayload.extend({ deliveryId: z.uuid() }),
  'regua.tenant': tenantJobPayload,
  'webhook.meta.process': tenantJobPayload.extend({ eventId: z.uuid() }),
  'templates.sync': tenantJobPayload.extend({ channelId: z.uuid() }),
} as const;

/**
 * Jobs da plataforma: não carregam tenant e não acessam dado de tenant. Só despacham um
 * job por escritório (exceção documentada à regra 6 do CLAUDE.md, incremento 3).
 */
export const PLATFORM_JOBS = {
  'regua.dispatch': z.object({}).loose(),
} as const;

export type PlatformJobName = keyof typeof PLATFORM_JOBS;

/** Agenda do despacho da régua: a cada 15 minutos. */
export const REGUA_DISPATCH_CRON = '*/15 * * * *';

export type JobName = keyof typeof JOBS;
export type JobPayload<N extends JobName> = z.infer<(typeof JOBS)[N]>;

export function createBoss(
  connectionString: string,
  options: { supervise?: boolean; schedule?: boolean } = {},
): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    // O schema e as filas são instalados pelo `pnpm db:migrate`, com o papel owner.
    migrate: false,
    createSchema: false,
    supervise: options.supervise ?? false,
    // Só o worker liga o agendador (despacho da régua).
    schedule: options.schedule ?? false,
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
  options: { startAfterSeconds?: number } = {},
): Promise<string | null> {
  const data = JOBS[name].parse({ ...payload, tenantId: ctx.tenantId });
  return boss.send(name, data, {
    db: transactionalDb(tx),
    retryLimit: 5,
    retryBackoff: true,
    ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
  });
}

/** Enfileira um job por escritório a partir de um job da plataforma (sem transação de tenant). */
export async function enqueueForTenant<N extends JobName>(
  boss: PgBoss,
  tenantId: string,
  name: N,
  payload: Omit<JobPayload<N>, 'tenantId'>,
  options: { singletonKey?: string; singletonSeconds?: number } = {},
): Promise<string | null> {
  const data = JOBS[name].parse({ ...payload, tenantId });
  return boss.send(name, data, { retryLimit: 3, retryBackoff: true, ...options });
}
