import type { TenantId } from '@contab/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { contacts, deliveries } from '../schema';
import type { TenantTx } from '../tenant';

export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryStatus = Delivery['status'];

export type DeliveryInput = {
  itemType: Delivery['itemType'];
  itemId: string;
  companyId: string;
  contactId: string;
  channel: Delivery['channel'];
  trigger: Delivery['trigger'];
  templateKey: string;
  fallbackOf?: string | null;
};

/** Cria a entrega, ou devolve null se ela já existe (idempotência). */
export async function insertDeliveryIfAbsent(
  tx: TenantTx,
  tenantId: TenantId,
  input: DeliveryInput,
): Promise<Delivery | null> {
  const [row] = await tx
    .insert(deliveries)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoNothing({
      target: [
        deliveries.tenantId,
        deliveries.itemId,
        deliveries.contactId,
        deliveries.channel,
        deliveries.trigger,
      ],
    })
    .returning();
  return row ?? null;
}

export async function getDelivery(tx: TenantTx, deliveryId: string): Promise<Delivery> {
  const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!row) throw new NotFoundError('delivery', deliveryId);
  return row;
}

export async function updateDelivery(
  tx: TenantTx,
  deliveryId: string,
  patch: Partial<
    Pick<
      Delivery,
      | 'status'
      | 'attempts'
      | 'providerMessageId'
      | 'failureReason'
      | 'sentAt'
      | 'deliveredAt'
      | 'readAt'
    >
  >,
): Promise<void> {
  await tx
    .update(deliveries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));
}

export async function findDeliveryByProviderId(
  tx: TenantTx,
  providerMessageId: string,
): Promise<Delivery | null> {
  const [row] = await tx
    .select()
    .from(deliveries)
    .where(eq(deliveries.providerMessageId, providerMessageId));
  return row ?? null;
}

export type DeliveryRow = Delivery & { contactName: string };

export async function listItemDeliveries(tx: TenantTx, itemId: string): Promise<DeliveryRow[]> {
  const rows = await tx
    .select({ d: deliveries, contactName: contacts.name })
    .from(deliveries)
    .innerJoin(
      contacts,
      and(eq(contacts.tenantId, deliveries.tenantId), eq(contacts.id, deliveries.contactId)),
    )
    .where(eq(deliveries.itemId, itemId))
    .orderBy(desc(deliveries.createdAt));
  return rows.map((r) => ({ ...r.d, contactName: r.contactName }));
}

/** Cancela as entregas ainda na fila de um item (guia paga ou cancelada). */
export async function cancelQueuedDeliveries(tx: TenantTx, itemId: string): Promise<number> {
  const rows = await tx
    .update(deliveries)
    .set({ status: 'cancelado', updatedAt: new Date() })
    .where(and(eq(deliveries.itemId, itemId), inArray(deliveries.status, ['enfileirado'])))
    .returning({ id: deliveries.id });
  return rows.length;
}
