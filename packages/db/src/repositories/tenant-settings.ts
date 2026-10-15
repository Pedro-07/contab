import type { TenantId } from '@contab/domain';
import { tenantSettings } from '../schema';
import type { TenantTx } from '../tenant';

export async function createTenantSettings(tx: TenantTx, tenantId: TenantId): Promise<void> {
  await tx.insert(tenantSettings).values({ tenantId });
}

export async function getTenantSettings(tx: TenantTx) {
  const [row] = await tx.select().from(tenantSettings);
  return row ?? null;
}

export async function updateDeliverySettings(
  tx: TenantTx,
  settings: { reminderDaysBefore: number; deliveryHour: number; replyToEmail: string | null },
): Promise<void> {
  await tx.update(tenantSettings).set({ ...settings, updatedAt: new Date() });
}
