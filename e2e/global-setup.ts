/** Banco de teste do zero, migrado e com o seed de Alfa e Beta, antes do E2E. */
import { createFileStorage } from '@contab/adapters/storage';
import { createDb, installDatabase, seed } from '@contab/db/testing';

export default async function globalSetup() {
  const owner = createDb(process.env.DATABASE_MIGRATOR_URL!, { max: 1 });
  try {
    await owner.$client.query(`
      DROP SCHEMA IF EXISTS pgboss CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO PUBLIC;
    `);
  } finally {
    await owner.$client.end();
  }
  await installDatabase(process.env.DATABASE_MIGRATOR_URL!);
  const app = createDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    await seed(app);
  } finally {
    await app.$client.end();
  }
  // Bucket de teste com o envio direto liberado para o painel.
  await createFileStorage({
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT!,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET!,
    STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID!,
    STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY!,
  }).ensureBucket(['http://app.localhost:3000']);
  // Caixa do Mailpit limpa.
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
}
