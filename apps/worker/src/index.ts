import { createCipher } from '@contab/adapters/crypto';
import { createEmailSender } from '@contab/adapters/email';
import { createFileStorage } from '@contab/adapters/storage';
import { createWhatsAppProvider } from '@contab/adapters/whatsapp';
import { serverEnv } from '@contab/config/env';
import { logger } from '@contab/config/logger';
import { portalOriginFrom } from '@contab/core';
import { createBoss, REGUA_DISPATCH_CRON } from '@contab/db/queue';
import { InvalidJobPayloadError } from './define-job';
import { createJobs } from './jobs';
import { dispatchRegua } from './jobs/platform';

const env = serverEnv();
const boss = createBoss(env.DATABASE_URL, { supervise: true, schedule: true });
boss.on('error', (error) => logger.error({ err: error.message }, 'erro no pg-boss'));

await boss.start();

const deps = {
  email: createEmailSender(env),
  painelUrl: env.BETTER_AUTH_URL,
  storage: createFileStorage(env),
  boss,
  whatsapp: createWhatsAppProvider(env),
  cipher: createCipher(env),
  portalOrigin: portalOriginFrom(env.BETTER_AUTH_URL, env.APP_BASE_DOMAIN),
  linkSecret: env.BETTER_AUTH_SECRET,
};

for (const job of createJobs(deps)) {
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

// Despacho da régua (job da plataforma, sem tenant).
await boss.schedule('regua.dispatch', REGUA_DISPATCH_CRON, {}, { tz: 'UTC' });
await boss.work('regua.dispatch', async () => {
  const n = await dispatchRegua(boss);
  logger.info({ job_name: 'regua.dispatch', escritorios: n }, 'régua despachada');
});

const shutdown = async () => {
  logger.info('encerrando worker');
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
