import { createEmailSender } from '@contab/adapters/email';
import { serverEnv } from '@contab/config/env';
import { logger } from '@contab/config/logger';
import { createBoss } from '@contab/db/queue';
import { InvalidJobPayloadError } from './define-job';
import { createJobs } from './jobs';

const env = serverEnv();
const boss = createBoss(env.DATABASE_URL, { supervise: true });
boss.on('error', (error) => logger.error({ err: error.message }, 'erro no pg-boss'));

await boss.start();

for (const job of createJobs({ email: createEmailSender(env), painelUrl: env.BETTER_AUTH_URL })) {
  await boss.work(job.name, async ([item]) => {
    if (!item) return;
    try {
      await job.run({ id: item.id, data: item.data });
    } catch (error) {
      if (error instanceof InvalidJobPayloadError) {
        // Payload inválido não melhora com retentativa: falha de vez.
        await boss.fail(job.name, item.id, { motivo: 'payload_invalido' });
        return;
      }
      throw error;
    }
  });
  logger.info({ job_name: job.name }, 'worker registrado');
}

const shutdown = async () => {
  logger.info('encerrando worker');
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
