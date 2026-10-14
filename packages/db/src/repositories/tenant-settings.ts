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
