/**
 * Links seguros (RN14), webhooks recebidos, alertas internos e códigos de login do portal.
 */
import type { TenantId } from '@contab/domain';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  portalLoginCodes,
  secureLinkAccesses,
  secureLinks,
  tenantAlerts,
  webhookEvents,
} from '../schema';
import type { TenantTx } from '../tenant';

// ---------------------------------------------------------------------------
// Links seguros
// ---------------------------------------------------------------------------

export type SecureLink = typeof secureLinks.$inferSelect;

export async function insertSecureLink(
  tx: TenantTx,
  tenantId: TenantId,
  input: { tokenHash: string; itemId: string; expiresAt: Date },
): Promise<SecureLink> {
  const [row] = await tx
    .insert(secureLinks)
    .values({ tenantId, id: uuidv7(), itemType: 'guia', ...input })
    .returning();
  return row!;
}

/** Link pelo hash do token, só no tenant do contexto (o do subdomínio). */
export async function findSecureLink(tx: TenantTx, tokenHash: string): Promise<SecureLink | null> {
  const [row] = await tx.select().from(secureLinks).where(eq(secureLinks.tokenHash, tokenHash));
  return row ?? null;
}

/** Conta a abertura e registra quando e de onde. */
export async function recordLinkAccess(
  tx: TenantTx,
  tenantId: TenantId,
  linkId: string,
  ip: string | null,
): Promise<void> {
  await tx
    .update(secureLinks)
    .set({ accessCount: sql`${secureLinks.accessCount} + 1` })
    .where(eq(secureLinks.id, linkId));
  await tx.insert(secureLinkAccesses).values({ tenantId, id: uuidv7(), linkId, ip });
}

/** Encerra os links de um item (guia paga ou substituída, RN14). */
export async function revokeItemLinks(tx: TenantTx, itemId: string): Promise<void> {
  await tx
    .update(secureLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(secureLinks.itemId, itemId), isNull(secureLinks.revokedAt)));
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookEvent = typeof webhookEvents.$inferSelect;

/** Grava o evento uma vez só; devolve null se o ID externo já existia. */
export async function insertWebhookEvent(
  tx: TenantTx,
  tenantId: TenantId,
  input: { provider: string; externalId: string; kind: string; payload: unknown },
): Promise<WebhookEvent | null> {
  const [row] = await tx
    .insert(webhookEvents)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoNothing({
      target: [webhookEvents.tenantId, webhookEvents.provider, webhookEvents.externalId],
    })
    .returning();
  return row ?? null;
}

export async function getWebhookEvent(tx: TenantTx, eventId: string): Promise<WebhookEvent | null> {
  const [row] = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  return row ?? null;
}

export async function markWebhookProcessed(
  tx: TenantTx,
  eventId: string,
  error: string | null = null,
): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ processedAt: new Date(), error })
    .where(eq(webhookEvents.id, eventId));
}

// ---------------------------------------------------------------------------
// Alertas internos
// ---------------------------------------------------------------------------

export type TenantAlert = typeof tenantAlerts.$inferSelect;

/** Cria o alerta, sem repetir um aberto do mesmo tipo para o mesmo recurso. */
export async function raiseAlert(
  tx: TenantTx,
  tenantId: TenantId,
  input: { kind: string; message: string; resourceType?: string; resourceId?: string },
): Promise<void> {
  const [open] = await tx
    .select({ id: tenantAlerts.id })
    .from(tenantAlerts)
    .where(
      and(
        eq(tenantAlerts.kind, input.kind),
        input.resourceId
          ? eq(tenantAlerts.resourceId, input.resourceId)
          : isNull(tenantAlerts.resourceId),
        isNull(tenantAlerts.resolvedAt),
      ),
    )
    .limit(1);
  if (open) return;
  await tx.insert(tenantAlerts).values({
    tenantId,
    id: uuidv7(),
    kind: input.kind,
    message: input.message,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
  });
}

export async function listOpenAlerts(tx: TenantTx, limit = 50): Promise<TenantAlert[]> {
  return tx
    .select()
    .from(tenantAlerts)
    .where(isNull(tenantAlerts.resolvedAt))
    .orderBy(desc(tenantAlerts.createdAt))
    .limit(limit);
}

export async function resolveAlert(tx: TenantTx, alertId: string): Promise<boolean> {
  const rows = await tx
    .update(tenantAlerts)
    .set({ resolvedAt: new Date() })
    .where(and(eq(tenantAlerts.id, alertId), isNull(tenantAlerts.resolvedAt)))
    .returning({ id: tenantAlerts.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Códigos de login do portal (P3)
// ---------------------------------------------------------------------------

export type PortalLoginCode = typeof portalLoginCodes.$inferSelect;

export async function insertLoginCode(
  tx: TenantTx,
  tenantId: TenantId,
  input: { contactId: string; codeHash: string; expiresAt: Date; ip: string | null },
): Promise<void> {
  await tx.insert(portalLoginCodes).values({ tenantId, id: uuidv7(), ...input });
}

/** Último código válido do contato (não usado e não vencido). */
export async function findActiveLoginCode(
  tx: TenantTx,
  contactId: string,
): Promise<PortalLoginCode | null> {
  const [row] = await tx
    .select()
    .from(portalLoginCodes)
    .where(
      and(
        eq(portalLoginCodes.contactId, contactId),
        isNull(portalLoginCodes.usedAt),
        gt(portalLoginCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(portalLoginCodes.createdAt))
    .limit(1);
  return row ?? null;
}

export async function countLoginCodesSince(
  tx: TenantTx,
  by: { contactId: string } | { ip: string },
  since: Date,
): Promise<number> {
  const match =
    'contactId' in by
      ? eq(portalLoginCodes.contactId, by.contactId)
      : eq(portalLoginCodes.ip, by.ip);
  const [row] = await tx
    .select({ n: count() })
    .from(portalLoginCodes)
    .where(and(match, gt(portalLoginCodes.createdAt, since)));
  return row?.n ?? 0;
}

export async function updateLoginCode(
  tx: TenantTx,
  codeId: string,
  patch: { attempts?: number; usedAt?: Date },
): Promise<void> {
  await tx.update(portalLoginCodes).set(patch).where(eq(portalLoginCodes.id, codeId));
}
