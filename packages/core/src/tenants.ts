import {
  createTenantSettings,
  insertInvitation,
  recordAudit,
  withTenant,
  type TenantContext,
} from '@contab/db';
import { findTenantBySlug, insertTenant } from '@contab/db/global';
import { enqueue } from '@contab/db/queue';
import { asTenantId, invitationExpiresAt, isValidSlug, normalizeEmail } from '@contab/domain';
import type { PgBoss } from 'pg-boss';

export class TenantInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantInputError';
  }
}

/**
 * Cria um escritório e o convite do dono (P19: comando do operador).
 * O dono recebe o convite por e-mail, entra pelo link mágico e configura o TOTP.
 */
export async function createTenantWithOwner(
  boss: PgBoss,
  input: { slug: string; name: string; ownerEmail: string },
  operator: { requestId: string },
) {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) throw new TenantInputError('Slug inválido ou reservado.');
  const name = input.name.trim();
  if (name.length < 2) throw new TenantInputError('Nome muito curto.');
  const ownerEmail = normalizeEmail(input.ownerEmail);
  if (await findTenantBySlug(slug))
    throw new TenantInputError('Já existe um escritório com esse slug.');

  const tenant = await insertTenant({ slug, name });
  const tenantId = asTenantId(tenant.id);
  const ctx: TenantContext = {
    tenantId,
    actor: { type: 'system', jobName: 'tenant:create', jobId: operator.requestId },
    requestId: operator.requestId,
  };

  const invitation = await withTenant(ctx, async (tx) => {
    await createTenantSettings(tx, tenantId);
    const inv = await insertInvitation(tx, {
      tenantId,
      email: ownerEmail,
      role: 'dono',
      invitedByUserId: null,
      expiresAt: invitationExpiresAt(new Date()),
    });
    await enqueue(boss, ctx, tx, 'invitation.send-email', { invitationId: inv.id });
    await recordAudit(tx, ctx, {
      action: 'escritorio.criado',
      resourceType: 'tenant',
      resourceId: tenantId,
    });
    return inv;
  });

  return { tenant, invitationId: invitation.id };
}
