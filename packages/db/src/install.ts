/**
 * Instala o schema: migrações do Drizzle e a fila do pg-boss, sempre com o papel owner.
 * Usado pelo `pnpm db:migrate` e pela preparação dos testes.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { fileURLToPath } from 'node:url';
import { createDb } from './internal';
import { JOBS, PGBOSS_SCHEMA } from './queue';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Papel de login da aplicação (infra/postgres/init; runbook no Neon). */
const APP_ROLE = 'app';

export async function installDatabase(migratorUrl: string): Promise<void> {
  const db = createDb(migratorUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }

  // pg-boss cria uma tabela por fila, e o papel app não tem permissão de DDL.
  // Por isso o schema e as filas nascem aqui, e o app só recebe permissão de uso.
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: PGBOSS_SCHEMA,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    for (const name of Object.keys(JOBS)) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name);
    }
  } finally {
    await boss.stop({ graceful: false });
  }

  const grants = createDb(migratorUrl, { max: 1 });
  try {
    for (const statement of [
      `GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
    ]) {
      await grants.$client.query(statement);
    }
  } finally {
    await grants.$client.end();
  }
}
