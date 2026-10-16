/**
 * Testes negativos de isolamento no banco (plano da Fundação, itens 1 a 9).
 * Rodam com o papel `app`, o mesmo da aplicação, e conferem o efeito no banco.
 */
import {
  getMember,
  listMembers,
  listMyOrganizations,
  withTenant,
  withUser,
  NotFoundError,
} from '@contab/db';
import { lookupInvitation } from '@contab/db/global';
import { invitations, memberships, tenantSettings } from '@contab/db/schema';
import type { Db } from '@contab/db/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { appDb, dbErrorMessage, ownerDb, systemCtx } from './helpers';

const seed = inject('seed');
const TENANT_TABLES = [
  'memberships',
  'invitations',
  'tenant_settings',
  'audit_logs',
  // Incremento 2
  'client_companies',
  'contacts',
  'contact_consents',
  'company_contacts',
  'client_access',
  'portal_sessions',
  'documents',
  'document_versions',
  // Incremento 3
  'channels',
  'credentials',
  'tenant_templates',
  'webhook_events',
  'deliveries',
  'guides',
  'guide_events',
  'secure_links',
  'secure_link_accesses',
  'portal_login_codes',
  'tenant_alerts',
  // Incremento 4
  'fiscal_connections',
  'fiscal_credentials',
  'fiscal_calls',
  'fiscal_watches',
];

let app: Db;
let owner: Db;

beforeAll(() => {
  app = appDb();
  owner = ownerDb();
});

afterAll(async () => {
  await app.$client.end();
  await owner.$client.end();
});

describe('catálogo (1)', () => {
  it('toda tabela com tenant_id tem RLS ativo e forçado e política que usa o tenant do contexto', async () => {
    const { rows } = await owner.$client.query<{
      table_name: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      select c.table_name,
             cls.relrowsecurity as rls,
             cls.relforcerowsecurity as forced,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.table_name
                 and (p.qual like '%app_current_tenant_id()%' or p.with_check like '%app_current_tenant_id()%'))::int as policies
        from information_schema.columns c
        join pg_class cls on cls.relname = c.table_name
        join pg_namespace n on n.oid = cls.relnamespace and n.nspname = 'public'
       where c.table_schema = 'public' and c.column_name = 'tenant_id' and cls.relkind = 'r'
    `);
    expect(rows.map((r) => r.table_name).sort()).toEqual([...TENANT_TABLES].sort());
    for (const row of rows) {
      expect(row, row.table_name).toMatchObject({ rls: true, forced: true });
      expect(row.policies, row.table_name).toBeGreaterThan(0);
    }
  });
});

describe('papel da aplicação (2, 7)', () => {
  it('app não é superusuário nem ignora RLS', async () => {
    const { rows } = await app.$client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('app não altera nem apaga auditoria', async () => {
    await expect(app.$client.query('update audit_logs set action = action')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$client.query('delete from audit_logs')).rejects.toThrow(/permission denied/);
  });

  it('app só insere em security_events, sem ler', async () => {
    await expect(app.$client.query('select * from security_events')).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$client.query('delete from security_events')).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each(TENANT_TABLES.filter((t) => t !== 'audit_logs'))(
    'app não apaga linhas de %s (exclusão lógica)',
    async (table) => {
      await expect(app.$client.query(`delete from ${table}`)).rejects.toThrow(/permission denied/);
    },
  );

  it('app não altera o histórico de consentimento', async () => {
    await expect(app.$client.query('update contact_consents set status = status')).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('sem contexto (3)', () => {
  it.each(TENANT_TABLES)('select em %s devolve zero linhas', async (table) => {
    const { rows } = await app.$client.query(`select * from ${table}`);
    expect(rows).toHaveLength(0);
  });

  it('insert sem contexto é recusado', async () => {
    await expect(
      app.$client.query('insert into tenant_settings (tenant_id) values ($1)', [seed.alfa.id]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('contexto de Alfa contra dados de Beta (4)', () => {
  const alfaCtx = () => systemCtx(seed.alfa.id);

  it('select não vê Beta', async () => {
    const rows = await withTenant(alfaCtx(), (tx) => tx.select().from(memberships), app);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === seed.alfa.id)).toBe(true);
  });

  it('update e "delete lógico" em linha de Beta afetam zero linhas', async () => {
    const betaMember = (
      await owner.select().from(memberships).where(eq(memberships.tenantId, seed.beta.id))
    )[0]!;
    const updated = await withTenant(
      alfaCtx(),
      (tx) =>
        tx
          .update(memberships)
          .set({ role: 'atendente', deletedAt: new Date() })
          .where(eq(memberships.id, betaMember.id))
          .returning(),
      app,
    );
    expect(updated).toHaveLength(0);
    const after = (
      await owner.select().from(memberships).where(eq(memberships.id, betaMember.id))
    )[0]!;
    expect(after.role).toBe(betaMember.role);
    expect(after.deletedAt).toBeNull();
  });

  it('insert com tenant_id de Beta é recusado', async () => {
    expect(
      await dbErrorMessage(
        withTenant(
          alfaCtx(),
          (tx) =>
            tx.insert(invitations).values({
              tenantId: seed.beta.id,
              id: randomUUID(),
              email: 'x@exemplo.test',
              role: 'atendente',
              expiresAt: new Date(Date.now() + 3600_000),
            }),
          app,
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('repositório responde NotFound para ID de Beta', async () => {
    const betaMember = (
      await owner.select().from(memberships).where(eq(memberships.tenantId, seed.beta.id))
    )[0]!;
    await expect(
      withTenant(alfaCtx(), (tx) => getMember(tx, betaMember.id), app),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('reúso da conexão do pool (5)', () => {
  it('a transação seguinte, na mesma conexão, não herda o tenant', async () => {
    const single = appDb(1);
    try {
      const inside = await withTenant(
        systemCtx(seed.alfa.id),
        (tx) => tx.execute<{ t: string | null }>(sql`select app_current_tenant_id() as t`),
        single,
      );
      expect(inside.rows[0]?.t).toBe(seed.alfa.id);

      // Mesma (única) conexão, sem withTenant.
      const leaked = await single.$client.query<{ t: string | null }>(
        'select app_current_tenant_id() as t',
      );
      expect(leaked.rows[0]?.t).toBeNull();
      const rows = await single.$client.query('select * from memberships');
      expect(rows.rows).toHaveLength(0);
    } finally {
      await single.$client.end();
    }
  });

  it('erro dentro da transação desfaz e também limpa o contexto', async () => {
    const single = appDb(1);
    try {
      await expect(
        withTenant(
          systemCtx(seed.alfa.id),
          async () => {
            throw new Error('falha proposital');
          },
          single,
        ),
      ).rejects.toThrow('falha proposital');
      const { rows } = await single.$client.query<{ t: string | null }>(
        'select app_current_tenant_id() as t',
      );
      expect(rows[0]?.t).toBeNull();
    } finally {
      await single.$client.end();
    }
  });
});

describe('estrangeira composta (6)', () => {
  it('convite não pode apontar para membro de outro tenant', async () => {
    // donoBeta é membro de Beta, não de Alfa.
    expect(
      await dbErrorMessage(
        withTenant(
          systemCtx(seed.alfa.id),
          (tx) =>
            tx.insert(invitations).values({
              tenantId: seed.alfa.id,
              id: randomUUID(),
              email: 'y@exemplo.test',
              role: 'atendente',
              invitedByUserId: seed.users.donoBeta.id,
              expiresAt: new Date(Date.now() + 3600_000),
            }),
          app,
        ),
      ),
    ).toMatch(/invitations_invited_by_fk/);
  });
});

describe('memberships do próprio usuário (8)', () => {
  it('withUser lista só as memberships do usuário, nos dois tenants', async () => {
    const orgs = await withUser(
      seed.users.duplo.id,
      (tx) => listMyOrganizations(tx, seed.users.duplo.id),
      app,
    );
    expect(orgs.map((o) => o.slug).sort()).toEqual(['alfa', 'beta']);
    const raw = await withUser(seed.users.duplo.id, (tx) => tx.select().from(memberships), app);
    expect(raw.every((m) => m.userId === seed.users.duplo.id)).toBe(true);
  });

  it('no contexto de Alfa, a lista de membros não traz nada de Beta, nem do próprio Duplo', async () => {
    const ctx = {
      tenantId: seed.alfa.id,
      actor: { type: 'member' as const, userId: seed.users.duplo.id, role: 'atendente' as const },
      requestId: 'teste',
    };
    const members = await withTenant(ctx, (tx) => listMembers(tx), app);
    const emails = members.map((m) => m.email);
    expect(emails).toContain('duplo@teste.test');
    expect(emails).not.toContain('dono@beta.test');
    // A linha do Duplo em Beta é visível pela política own_memberships_read,
    // mas o repositório filtra pelo tenant do contexto.
    expect(emails.filter((e) => e === 'duplo@teste.test')).toHaveLength(1);
  });

  it('o usuário não altera a própria membership de outro tenant', async () => {
    const ctx = systemCtx(seed.alfa.id);
    const updated = await withTenant(
      { ...ctx, actor: { type: 'member', userId: seed.users.duplo.id, role: 'atendente' } },
      (tx) =>
        tx
          .update(memberships)
          .set({ role: 'dono' })
          .where(eq(memberships.tenantId, seed.beta.id))
          .returning(),
      app,
    );
    expect(updated).toHaveLength(0);
  });
});

describe('invitation_lookup (9)', () => {
  it('hash inexistente devolve vazio', async () => {
    expect(await lookupInvitation('0'.repeat(64), app)).toBeNull();
  });

  it('convite expirado, revogado ou aceito devolve vazio; válido devolve o tenant', async () => {
    const make = async (patch: Partial<typeof invitations.$inferInsert>) => {
      const tokenHash = randomUUID().replaceAll('-', '').padEnd(64, 'a');
      await withTenant(
        systemCtx(seed.beta.id),
        (tx) =>
          tx.insert(invitations).values({
            tenantId: seed.beta.id,
            id: randomUUID(),
            email: 'z@exemplo.test',
            role: 'atendente',
            tokenHash,
            expiresAt: new Date(Date.now() + 3600_000),
            ...patch,
          }),
        app,
      );
      return tokenHash;
    };
    expect(
      await lookupInvitation(await make({ expiresAt: new Date(Date.now() - 1000) }), app),
    ).toBeNull();
    expect(await lookupInvitation(await make({ revokedAt: new Date() }), app)).toBeNull();
    expect(await lookupInvitation(await make({ acceptedAt: new Date() }), app)).toBeNull();
    expect(await lookupInvitation(await make({}), app)).toMatchObject({ tenantId: seed.beta.id });
  });

  it('app não lê convites sem contexto, mesmo com a função existindo', async () => {
    const { rows } = await app.$client.query('select * from invitations');
    expect(rows).toHaveLength(0);
  });
});

describe('tenant_settings', () => {
  it('cada tenant vê só a própria configuração', async () => {
    const rows = await withTenant(
      systemCtx(seed.beta.id),
      (tx) => tx.select().from(tenantSettings),
      app,
    );
    expect(rows.map((r) => r.tenantId)).toEqual([seed.beta.id]);
  });
});
