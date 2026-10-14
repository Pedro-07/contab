/**
 * Prepara o banco de teste do zero a cada execução: apaga os schemas, aplica as
 * migrações com o papel owner e cria o seed com dois tenants (Alfa e Beta).
 */
import { createDb, installDatabase, seed, type SeedResult } from '@contab/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    seed: SeedResult;
  }
}

export default async function setup(project: TestProject) {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!migratorUrl || !appUrl)
    throw new Error('DATABASE_MIGRATOR_URL e DATABASE_URL são obrigatórias nos testes');

  const owner = createDb(migratorUrl, { max: 1 });
  try {
    await owner.$client.query(`
      DROP SCHEMA IF EXISTS pgboss CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO PUBLIC;
    `);
  } catch (error) {
    throw new Error(
      `Não consegui conectar ao Postgres de teste. Rode "docker compose up -d" antes. (${(error as Error).message})`,
      { cause: error },
    );
  } finally {
    await owner.$client.end();
  }

  await installDatabase(migratorUrl);

  const app = createDb(appUrl, { max: 2 });
  try {
    project.provide('seed', await seed(app));
  } finally {
    await app.$client.end();
  }
}
