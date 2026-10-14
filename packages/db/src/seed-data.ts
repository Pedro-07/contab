/**
 * Dados fictícios para desenvolvimento e testes de isolamento (plano, seção 9: nenhum
 * dado de produção fora de produção). Dois escritórios e um usuário que está nos dois.
 */
import { asTenantId, asUserId, type Role, type TenantId, type UserId } from '@contab/domain';
import { getDb, type Db } from './internal';
import { findTenantBySlug, findUserByEmail, insertTenant, insertUser } from './global';
import { upsertMembership } from './repositories/memberships';
import { createTenantSettings } from './repositories/tenant-settings';
import { withTenant, type TenantContext } from './tenant';

export type SeedTenant = { id: TenantId; slug: string; name: string };
export type SeedUser = { id: UserId; email: string };

export type SeedResult = {
  alfa: SeedTenant;
  beta: SeedTenant;
  users: Record<
    'donoAlfa' | 'adminAlfa' | 'contadorAlfa' | 'atendenteAlfa' | 'donoBeta' | 'duplo',
    SeedUser
  >;
};

const TENANTS = [
  { key: 'alfa', slug: 'alfa', name: 'Escritório Alfa (fictício)' },
  { key: 'beta', slug: 'beta', name: 'Escritório Beta (fictício)' },
] as const;

const MEMBERS: Array<{
  key: keyof SeedResult['users'];
  email: string;
  roles: Partial<Record<'alfa' | 'beta', Role>>;
}> = [
  { key: 'donoAlfa', email: 'dono@alfa.test', roles: { alfa: 'dono' } },
  { key: 'adminAlfa', email: 'admin@alfa.test', roles: { alfa: 'admin' } },
  { key: 'contadorAlfa', email: 'contador@alfa.test', roles: { alfa: 'contador' } },
  { key: 'atendenteAlfa', email: 'atendente@alfa.test', roles: { alfa: 'atendente' } },
  { key: 'donoBeta', email: 'dono@beta.test', roles: { beta: 'dono' } },
  { key: 'duplo', email: 'duplo@teste.test', roles: { alfa: 'atendente', beta: 'contador' } },
];

/** Idempotente: pode rodar de novo sem duplicar. */
export async function seed(db: Db = getDb()): Promise<SeedResult> {
  const tenants = {} as Record<'alfa' | 'beta', SeedTenant>;
  for (const t of TENANTS) {
    const existing = await findTenantBySlug(t.slug, db);
    const row = existing ?? (await insertTenant({ slug: t.slug, name: t.name }, db));
    const id = asTenantId(row.id);
    if (!existing) {
      await withTenant(seedContext(id), (tx) => createTenantSettings(tx, id), db);
    }
    tenants[t.key] = { id, slug: row.slug, name: row.name };
  }

  const users = {} as SeedResult['users'];
  for (const m of MEMBERS) {
    const user = (await findUserByEmail(m.email, db)) ?? (await insertUser({ email: m.email }, db));
    const userId = asUserId(user.id);
    users[m.key] = { id: userId, email: user.email };
    for (const [tenantKey, role] of Object.entries(m.roles) as Array<['alfa' | 'beta', Role]>) {
      const tenantId = tenants[tenantKey].id;
      await withTenant(
        seedContext(tenantId),
        (tx) => upsertMembership(tx, tenantId, userId, role),
        db,
      );
    }
  }

  return { alfa: tenants.alfa, beta: tenants.beta, users };
}

function seedContext(tenantId: TenantId): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'seed', jobId: 'seed' },
    requestId: 'seed',
  };
}
