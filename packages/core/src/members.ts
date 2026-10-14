import {
  countActiveOwners,
  getMember,
  listMembers,
  recordAudit,
  removeMember as removeMemberRow,
  updateMemberRole,
  withTenant,
  type Member,
  type TenantContext,
} from '@contab/db';
import {
  canManageMembers,
  checkMemberRemoval,
  checkRoleChange,
  isRole,
  type Role,
} from '@contab/domain';
import { actorRole, deny, logNotFound } from './guard';

const DENIAL_MESSAGES = {
  sem_permissao: 'Seu papel não permite esta ação.',
  alvo_dono: 'Só um dono pode alterar outro dono.',
  ultimo_dono: 'O escritório precisa de pelo menos um dono.',
} as const;

async function requireManager(ctx: TenantContext): Promise<Role> {
  const role = actorRole(ctx);
  if (!role || !canManageMembers(role))
    return deny(ctx, DENIAL_MESSAGES.sem_permissao, 'membership');
  return role;
}

export async function listTeam(ctx: TenantContext): Promise<Member[]> {
  await requireManager(ctx);
  return withTenant(ctx, (tx) => listMembers(tx));
}

export async function changeMemberRole(
  ctx: TenantContext,
  membershipId: string,
  newRole: string,
): Promise<void> {
  const actor = await requireManager(ctx);
  if (!isRole(newRole)) return deny(ctx, 'Papel inválido.', 'membership');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const member = await getMember(tx, membershipId);
      const denial = checkRoleChange({
        actor,
        from: member.role,
        to: newRole,
        activeOwners: await countActiveOwners(tx),
      });
      if (denial) return deny(ctx, DENIAL_MESSAGES[denial], 'membership');
      await updateMemberRole(tx, membershipId, newRole);
      await recordAudit(tx, ctx, {
        action: 'membro.papel_alterado',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { de: member.role, para: newRole },
      });
    }),
  );
}

export async function removeMember(ctx: TenantContext, membershipId: string): Promise<void> {
  const actor = await requireManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const member = await getMember(tx, membershipId);
      const denial = checkMemberRemoval({
        actor,
        target: member.role,
        activeOwners: await countActiveOwners(tx),
      });
      if (denial) return deny(ctx, DENIAL_MESSAGES[denial], 'membership');
      await removeMemberRow(tx, membershipId);
      await recordAudit(tx, ctx, {
        action: 'membro.removido',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { papel: member.role },
      });
    }),
  );
}
