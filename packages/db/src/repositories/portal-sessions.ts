import type { TenantId } from '@contab/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { portalSessions } from '../schema';
import type { TenantTx } from '../tenant';

export type PortalSession = typeof portalSessions.$inferSelect;

export async function insertPortalSession(
  tx: TenantTx,
  tenantId: TenantId,
  input: { tokenHash: string; contactId: string; activeCompanyId: string | null; expiresAt: Date },
): Promise<PortalSession> {
  const [row] = await tx
    .insert(portalSessions)
    .values({ tenantId, id: uuidv7(), ...input })
    .returning();
  return row!;
}

/** Sessão vigente pelo hash do token, só no tenant do contexto (o do subdomínio). */
export async function findPortalSession(
  tx: TenantTx,
  tokenHash: string,
): Promise<PortalSession | null> {
  const [row] = await tx
    .select()
    .from(portalSessions)
    .where(
      and(
        eq(portalSessions.tokenHash, tokenHash),
        isNull(portalSessions.revokedAt),
        gt(portalSessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

export async function setPortalActiveCompany(
  tx: TenantTx,
  sessionId: string,
  companyId: string | null,
): Promise<void> {
  await tx
    .update(portalSessions)
    .set({ activeCompanyId: companyId })
    .where(eq(portalSessions.id, sessionId));
}

export async function revokePortalSession(tx: TenantTx, sessionId: string): Promise<void> {
  await tx
    .update(portalSessions)
    .set({ revokedAt: new Date() })
    .where(eq(portalSessions.id, sessionId));
}
