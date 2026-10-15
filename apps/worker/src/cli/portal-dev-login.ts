/**
 * Link de entrada no portal, só para desenvolvimento e testes (incremento 2, D1).
 * O login de verdade (código no WhatsApp, P3) chega com a conexão do WhatsApp.
 * Uso: pnpm portal:dev-login --slug alfa --phone "(98) 99000-0001"
 */
import { createPortalDevLink, portalDevLoginAllowed } from '@contab/core';
import { serverEnv } from '@contab/config/env';
import { findContactByPhone, withTenant } from '@contab/db';
import { findTenantBySlug, getDb } from '@contab/db/global';
import { asTenantId, parsePhone } from '@contab/domain';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const env = serverEnv();
if (!portalDevLoginAllowed(env.APP_ENV)) {
  console.error('portal:dev-login é só para desenvolvimento e testes.');
  process.exit(1);
}

const { values } = parseArgs({ options: { slug: { type: 'string' }, phone: { type: 'string' } } });
const phone = values.phone ? parsePhone(values.phone) : null;
if (!values.slug || !phone) {
  console.error('Uso: pnpm portal:dev-login --slug <slug> --phone "<telefone do contato>"');
  process.exit(1);
}

try {
  const tenant = await findTenantBySlug(values.slug);
  if (!tenant) throw new Error('Escritório não encontrado.');
  const tenantId = asTenantId(tenant.id);
  const meta = { requestId: `cli:${randomUUID()}` };
  const contact = await withTenant(
    {
      tenantId,
      actor: { type: 'system', jobName: 'portal.dev-login', jobId: meta.requestId },
      ...meta,
    },
    (tx) => findContactByPhone(tx, phone),
  );
  if (!contact) throw new Error('Contato não encontrado neste escritório.');
  const token = await createPortalDevLink(env.APP_ENV, tenantId, contact.id, meta);
  const base = new URL(env.BETTER_AUTH_URL);
  base.host = `${tenant.slug}.${env.APP_BASE_DOMAIN}`;
  console.log(`Abra em até 10 minutos (uso único):\n${base.origin}/entrar-dev/${token}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await getDb().$client.end();
}
