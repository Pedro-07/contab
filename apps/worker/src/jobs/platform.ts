/**
 * Jobs da plataforma (incremento 3): não carregam tenant e não acessam tabela de tenant.
 * O despacho da régua só lista os escritórios ativos (tabela global) e enfileira um
 * regua.tenant por escritório, que roda dentro da transação do tenant (regra 6).
 */
import { listActiveTenantIds } from '@contab/db/global';
import { enqueueForTenant } from '@contab/db/queue';
import type { PgBoss } from 'pg-boss';

export async function dispatchRegua(boss: PgBoss): Promise<number> {
  const tenants = await listActiveTenantIds();
  for (const tenantId of tenants) {
    // No máximo um por escritório a cada 15 min, mesmo se o despacho rodar duas vezes.
    await enqueueForTenant(
      boss,
      tenantId,
      'regua.tenant',
      {},
      { singletonKey: `regua:${tenantId}`, singletonSeconds: 15 * 60 },
    );
  }
  return tenants.length;
}
