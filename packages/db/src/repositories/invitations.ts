import type { Role, TenantId, UserId } from '@contab/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { invitations } from '../schema';
import type { TenantTx } from '../tenant';

export type Invitation = typeof invitations.$inferSelect;

export async function listInvitations(tx: TenantTx): Promise<Invitation[]> {
  return tx.select().from(invitations).orderBy(desc(invitations.createdAt)).limit(200);
}

export async function getInvitation(tx: TenantTx, invitationId: string): Promise<Invitation> {
  const [row] = await tx.select().from(invitations).where(eq(invitations.id, invitationId));
  if (!row) throw new NotFoundError('invitation', invitationId);
  return row;
}

export async function insertInvitation(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    email: string;
    role: Role;
    invitedByUserId: UserId | null;
    expiresAt: Date;
  },
): Promise<Invitation> {
  const [row] = await tx
    .insert(invitations)
    .values({ id: uuidv7(), ...input })
    .returning();
  return row!;
}

const stillOpen = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** Grava o hash do token gerado pelo job de envio. O token em claro nunca é guardado. */
export async function setInvitationToken(
  tx: TenantTx,
  invitationId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  const rows = await tx
    .update(invitations)
    .set({ tokenHash, expiresAt })
    .where(and(eq(invitations.id, invitationId), stillOpen))
    .returning({ id: invitations.id });
  if (rows.length === 0) throw new NotFoundError('invitation', invitationId);
}

export async function revokeInvitation(tx: TenantTx, invitationId: string): Promise<void> {
  const rows = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), stillOpen))
    .returning({ id: invitations.id });
  if (rows.length === 0) throw new NotFoundError('invitation', invitationId);
}

/** Marca como aceito. Falha se outro aceite chegou antes (uso único). */
export async function markInvitationAccepted(
  tx: TenantTx,
  invitationId: string,
  userId: UserId,
): Promise<void> {
  const rows = await tx
    .update(invitations)
    .set({ acceptedAt: new Date(), acceptedByUserId: userId })
    .where(and(eq(invitations.id, invitationId), stillOpen))
    .returning({ id: invitations.id });
  if (rows.length === 0) throw new NotFoundError('invitation', invitationId);
}
