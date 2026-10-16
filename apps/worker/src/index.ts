import { createCipher } from '@contab/adapters/crypto';
import { createEmailSender } from '@contab/adapters/email';
import { createFileStorage } from '@contab/adapters/storage';
import { createWhatsAppProvider, mirrorToEmail } from '@contab/adapters/whatsapp';
import { serverEnv } from '@contab/config/env';
import { logger } from '@contab/config/logger';
import { portalOriginFrom } from '@contab/core';
import { createSerproPlatform } from '@contab/core/serpro-worker';
import { createBoss, REGUA_DISPATCH_CRON, SERPRO_DISPATCH_CRON } from '@contab/db/queue';
import { InvalidJobPayloadError } from './define-job';
import { createJobs } from './jobs';
import { dispatchRegua, dispatchSerpro } from './jobs/platform';

const env = serverEnv();
const boss = createBoss(env.DATABASE_URL, { supervise: true, schedule: true });
boss.on('error', (error) => logger.error({ err: error.message }, 'erro no pg-boss'));

await boss.start();

const email = createEmailSender(env);
const cipher = createCipher(env);
const deps = {
  email,
  painelUrl: env.BETTER_AUTH_URL,
  storage: createFileStorage(env),
  boss,
  // Simulado (dev e testes): cada mensagem aparece no Mailpit como <telefone>@whatsapp.simulado.
  whatsapp: createWhatsAppProvider(env, { mirror: mirrorToEmail((m) => email.send(m)) }),
  cipher,
  // Serpro: respostas gravadas (fake), ambiente de testes (trial) ou produção.
  serpro: createSerproPlatform(env, cipher),
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

// Despacho da rotina da Serpro (job da plataforma, sem tenant).
await boss.schedule('serpro.dispatch', SERPRO_DISPATCH_CRON, {}, { tz: 'UTC' });
await boss.work('serpro.dispatch', async () => {
  const n = await dispatchSerpro(boss);
  logger.info(
    { job_name: 'serpro.dispatch', escritorios: n, ambiente: env.SERPRO_PROVIDER },
    'rotina da Serpro despachada',
  );
});

const shutdown = async () => {
  logger.info('encerrando worker');
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
