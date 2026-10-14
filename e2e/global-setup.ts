/** Banco de teste do zero, migrado e com o seed de Alfa e Beta, antes do E2E. */
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
  // Caixa do Mailpit limpa.
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
}
