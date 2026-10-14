/**
 * Cria um escritório e envia o convite do dono (P19).
 * Uso: pnpm tenant:create --slug contact --name "Contact Consultoria" --owner-email dona@exemplo.com.br
 */
import { createTenantWithOwner } from '@contab/core';
import { createBoss } from '@contab/db/queue';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    'owner-email': { type: 'string' },
  },
});

if (!values.slug || !values.name || !values['owner-email']) {
  console.error('Uso: pnpm tenant:create --slug <slug> --name "<nome>" --owner-email <e-mail>');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}

const boss = createBoss(url);
await boss.start();
try {
  const { tenant } = await createTenantWithOwner(
    boss,
    { slug: values.slug, name: values.name, ownerEmail: values['owner-email'] },
    { requestId: `cli:${randomUUID()}` },
  );
  console.log(
    `Escritório criado: ${tenant.name} (${tenant.slug}). O convite do dono foi enfileirado.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: false });
  const { getDb } = await import('@contab/db/global');
  await getDb().$client.end();
}
