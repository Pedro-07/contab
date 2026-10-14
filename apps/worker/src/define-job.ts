/**
 * Envelope de todo job (CLAUDE.md, regra 6). Antes do handler:
 * 1. valida o payload com o schema do catálogo; sem tenantId ou inválido, falha sem executar;
 * 2. abre a transação do tenant (RLS) com ator `system`;
 * 3. põe tenant_id, job_id e job_name no contexto de log.
 */
import { logger } from '@contab/config/logger';
import { runWithLogContext } from '@contab/config/request-context';
import { withTenant, type TenantContext, type TenantTx } from '@contab/db';
import { JOBS, type JobName, type JobPayload } from '@contab/db/queue';
import { asTenantId } from '@contab/domain';

export class InvalidJobPayloadError extends Error {
  constructor(readonly jobName: string) {
    super(`Payload inválido no job ${jobName}`);
    this.name = 'InvalidJobPayloadError';
  }
}

export type JobHandler<N extends JobName> = (
  tx: TenantTx,
  ctx: TenantContext,
  payload: JobPayload<N>,
) => Promise<void>;

export type JobInput = { id: string; data: unknown };

export type JobDefinition<N extends JobName = JobName> = {
  name: N;
  run(job: JobInput): Promise<void>;
};

export function defineJob<N extends JobName>(name: N, handler: JobHandler<N>): JobDefinition<N> {
  return {
    name,
    async run(job) {
      const parsed = JOBS[name].safeParse(job.data);
      if (!parsed.success) {
        // Só os caminhos dos campos inválidos, nunca os valores.
        logger.error(
          {
            job_name: name,
            job_id: job.id,
            campos: parsed.error.issues.map((i) => i.path.join('.')),
          },
          'job recusado antes de executar',
        );
        throw new InvalidJobPayloadError(name);
      }
      const payload = parsed.data as JobPayload<N>;
      const ctx: TenantContext = {
        tenantId: asTenantId(payload.tenantId),
        actor: { type: 'system', jobName: name, jobId: job.id },
        requestId: `job:${job.id}`,
      };
      await runWithLogContext({ jobId: job.id, jobName: name, tenantId: ctx.tenantId }, () =>
        withTenant(ctx, (tx) => handler(tx, ctx, payload)),
      );
    },
  };
}
