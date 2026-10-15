/**
 * Instala o schema: migrações do Drizzle e a fila do pg-boss, sempre com o papel owner.
 * Usado pelo `pnpm db:migrate` e pela preparação dos testes.
 */
import { TEMPLATE_LIBRARY } from '@contab/domain';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './internal';
import { templateLibrary } from './schema';
import { uuidv7 } from 'uuidv7';
import { JOBS, PGBOSS_SCHEMA } from './queue';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Papel de login da aplicação (infra/postgres/init; runbook no Neon). */
const APP_ROLE = 'app';

export async function installDatabase(migratorUrl: string): Promise<void> {
  const db = createDb(migratorUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await syncTemplateLibrary(db);
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

/**
 * Grava a biblioteca de templates da plataforma (P9) a partir do código. Versão nova entra
 * como linha nova; as anteriores continuam, porque os WABAs podem ainda usá-las.
 */
async function syncTemplateLibrary(db: Db): Promise<void> {
  for (const def of Object.values(TEMPLATE_LIBRARY)) {
    await db
      .insert(templateLibrary)
      .values({
        id: uuidv7(),
        key: def.key,
        version: def.version,
        language: def.language,
        category: def.category,
        header: def.header,
        body: def.body,
        variables: def.variables,
        linkButton: def.linkButton,
        emailSubject: def.emailSubject,
      })
      .onConflictDoUpdate({
        target: [templateLibrary.key, templateLibrary.version, templateLibrary.language],
        // Uma versão publicada não muda de texto; só o assunto do e-mail pode ser ajustado.
        set: { emailSubject: sql`excluded.email_subject`, active: true },
      });
  }
}
