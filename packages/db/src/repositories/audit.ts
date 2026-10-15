import { desc } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auditLogs } from '../schema';
import type { TenantContext, TenantTx } from '../tenant';

export type AuditEntry = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Ação de negócio no log do tenant (P15). Só identificadores, nunca conteúdo. */
export async function recordAudit(
  tx: TenantTx,
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: ctx.tenantId,
    id: uuidv7(),
    actorType: ctx.actor.type,
    actorUserId: ctx.actor.type === 'member' ? ctx.actor.userId : null,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    ip: ctx.ip ?? null,
    requestId: ctx.requestId,
    metadata:
      ctx.actor.type === 'contact'
        ? { ...entry.metadata, contato: ctx.actor.contactId }
        : (entry.metadata ?? null),
  });
}

export async function listAudit(tx: TenantTx, limit = 100) {
  return tx.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
