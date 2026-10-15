/**
 * Prepara o bucket de desenvolvimento (SeaweedFS do docker compose): cria se faltar e
 * libera o envio direto do painel. Em produção, o bucket R2 segue o runbook.
 * Uso: pnpm storage:setup
 */
import { createFileStorage } from '@contab/adapters/storage';
import { serverEnv } from '@contab/config/env';

const env = serverEnv();
if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
  console.error('storage:setup é só para desenvolvimento e testes.');
  process.exit(1);
}
await createFileStorage(env).ensureBucket([env.BETTER_AUTH_URL.replace(/\/$/, '')]);
console.log(`Bucket ${env.STORAGE_BUCKET} pronto.`);
