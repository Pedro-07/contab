import type { Role, TenantId, UserId } from '@contab/domain';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { memberships, tenants, users } from '../schema';
import type { TenantTx, UserTx } from '../tenant';

export type Member = {
  id: string;
  userId: UserId;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
  createdAt: Date;
};

const memberColumns = {
  id: memberships.id,
  userId: sql<UserId>`${memberships.userId}`,
  email: users.email,
  name: users.name,
  role: memberships.role,
  twoFactorEnabled: users.twoFactorEnabled,
  createdAt: memberships.createdAt,
};

/**
 * Filtro explícito pelo tenant do contexto. O RLS já filtra, mas a política
 * own_memberships_read também deixaria passar as memberships do próprio usuário
 * em outros tenants, então toda consulta de tenant em memberships usa este filtro.
 */
const inCurrentTenant = eq(memberships.tenantId, sql`app_current_tenant_id()`);

export async function listMembers(tx: TenantTx): Promise<Member[]> {
  return tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inCurrentTenant, isNull(memberships.deletedAt)))
    .orderBy(asc(users.email));
}

export async function getMember(tx: TenantTx, membershipId: string): Promise<Member> {
  const [row] = await tx
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(inCurrentTenant, eq(memberships.id, membershipId), isNull(memberships.deletedAt)));
  if (!row) throw new NotFoundError('membership', membershipId);
  return row;
}

/** Membership ativa do usuário no tenant do contexto, ou null. */
export async function findActiveMembershipByUser(
  tx: TenantTx,
  userId: UserId,
): Promise<{ id: string; role: Role } | null> {
  const [row] = await tx
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(inCurrentTenant, eq(memberships.userId, userId), isNull(memberships.deletedAt)));
  return row ?? null;
}

export async function countActiveOwners(tx: TenantTx): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(inCurrentTenant, eq(memberships.role, 'dono'), isNull(memberships.deletedAt)));
  return row?.n ?? 0;
}

export async function updateMemberRole(
  tx: TenantTx,
  membershipId: string,
  role: Role,
): Promise<void> {
  const rows = await tx
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(and(inCurrentTenant, eq(memberships.id, membershipId), isNull(memberships.deletedAt)))
    .returning({ id: memberships.id });
  if (rows.length === 0) throw new NotFoundError('membership', membershipId);
}

export async function removeMember(tx: TenantTx, membershipId: string): Promise<void> {
  const rows = await tx
    .update(memberships)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(inCurrentTenant, eq(memberships.id, membershipId), isNull(memberships.deletedAt)))
    .returning({ id: memberships.id });
  if (rows.length === 0) throw new NotFoundError('membership', membershipId);
}

/**
 * Cria a membership do convite aceito, ou reativa a mesma linha se a pessoa já foi
 * membro (a chave (tenant_id, user_id) é única sem filtro).
 */
export async function upsertMembership(
  tx: TenantTx,
  tenantId: TenantId,
  userId: UserId,
  role: Role,
): Promise<string> {
  const [row] = await tx
    .insert(memberships)
    .values({ tenantId, id: uuidv7(), userId, role })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.userId],
      set: { role, deletedAt: null, updatedAt: new Date() },
    })
    .returning({ id: memberships.id });
  return row!.id;
}

export type MyOrganization = { tenantId: TenantId; slug: string; name: string; role: Role };

/** Organizações do próprio usuário (política own_memberships_read). */
export async function listMyOrganizations(tx: UserTx, userId: UserId): Promise<MyOrganization[]> {
  return tx
    .select({
      tenantId: sql<TenantId>`${memberships.tenantId}`,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(eq(memberships.userId, userId), isNull(memberships.deletedAt), isNull(tenants.deletedAt)),
    )
    .orderBy(asc(tenants.name));
}
