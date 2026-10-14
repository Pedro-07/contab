import { listAudit, withTenant, type TenantContext } from '@contab/db';
import { canViewAudit } from '@contab/domain';
import { actorRole, deny } from './guard';

export async function listTenantAudit(ctx: TenantContext) {
  const role = actorRole(ctx);
  if (!role || !canViewAudit(role))
    return deny(ctx, 'Seu papel não permite ver a auditoria.', 'audit_log');
  return withTenant(ctx, (tx) => listAudit(tx, 200));
}
