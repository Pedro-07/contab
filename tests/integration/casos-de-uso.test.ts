/**
 * Isolamento e autorização nos casos de uso (plano da Fundação, itens 12, 13, 16 e 17).
 * Cada teste confere a resposta, o banco e o log de segurança.
 */
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  InvalidInvitationError,
  listTeam,
  listTenantAudit,
  newInvitationToken,
  removeMember,
  revokeInvitation,
} from '@contab/core';
import { ForbiddenError, NotFoundError, setInvitationToken, withTenant } from '@contab/db';
import { createBoss } from '@contab/db/queue';
import { auditLogs, invitations, memberships } from '@contab/db/schema';
import type { Db } from '@contab/db/testing';
import { invitationExpiresAt } from '@contab/domain';
import { and, eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { memberCtx, ownerDb, securityEventsFor, systemCtx, uniqueEmail } from './helpers';

const seed = inject('seed');
let owner: Db;
let boss: PgBoss;

const donoAlfa = () => memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono');
const adminAlfa = () => memberCtx(seed.alfa.id, seed.users.adminAlfa.id, 'admin');
const contadorAlfa = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const atendenteAlfa = () => memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente');

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

async function betaMembershipId(): Promise<string> {
  const [row] = await owner
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, seed.beta.id), eq(memberships.userId, seed.users.donoBeta.id)),
    );
  return row!.id;
}

/** Convite com token conhecido, como se o job já tivesse enviado o e-mail. */
async function invitationWithToken(tenantId = seed.alfa.id, email = uniqueEmail('convidado')) {
  const ctx =
    tenantId === seed.alfa.id
      ? donoAlfa()
      : memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');
  const invitation = await createInvitation(ctx, boss, { email, role: 'contador' });
  const { token, hash } = newInvitationToken();
  await withTenant(systemCtx(tenantId), (tx) =>
    setInvitationToken(tx, invitation.id, hash, invitationExpiresAt(new Date())),
  );
  return { invitation, token, email };
}

describe('recurso de outro tenant pelo ID (12)', () => {
  it('alterar papel de membership de Beta: 404, sem efeito, evento registrado', async () => {
    const id = await betaMembershipId();
    const ctx = donoAlfa();
    await expect(changeMemberRole(ctx, id, 'atendente')).rejects.toBeInstanceOf(NotFoundError);
    const [after] = await owner.select().from(memberships).where(eq(memberships.id, id));
    expect(after!.role).toBe('dono');
    expect(await securityEventsFor(owner, ctx.requestId)).toEqual([
      { type: 'resource_not_found', resource_type: 'membership', resource_id: id },
    ]);
  });

  it('remover membership de Beta: 404, sem efeito', async () => {
    const id = await betaMembershipId();
    const ctx = donoAlfa();
    await expect(removeMember(ctx, id)).rejects.toBeInstanceOf(NotFoundError);
    const [after] = await owner.select().from(memberships).where(eq(memberships.id, id));
    expect(after!.deletedAt).toBeNull();
    expect((await securityEventsFor(owner, ctx.requestId))[0]?.type).toBe('resource_not_found');
  });

  it('revogar convite de Beta: 404, sem efeito', async () => {
    const { invitation } = await invitationWithToken(seed.beta.id);
    const ctx = donoAlfa();
    await expect(revokeInvitation(ctx, invitation.id)).rejects.toBeInstanceOf(NotFoundError);
    const [after] = await owner.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(after!.revokedAt).toBeNull();
  });

  it('ID que não existe em lugar nenhum recebe a mesma resposta (não revela existência)', async () => {
    const ctx = donoAlfa();
    await expect(
      changeMemberRole(ctx, '0190a000-0000-7000-8000-00000000dead', 'admin'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listas e auditoria de Alfa nunca trazem linhas de Beta', async () => {
    const team = await listTeam(donoAlfa());
    expect(team.map((m) => m.email)).not.toContain('dono@beta.test');
    const audit = await listTenantAudit(donoAlfa());
    expect(audit.every((a) => a.tenantId === seed.alfa.id)).toBe(true);
  });
});

describe('tenant só do contexto (13)', () => {
  it('os casos de uso não recebem tenant: o convite criado fica no tenant do contexto', async () => {
    const email = uniqueEmail('contexto');
    // Mesmo que alguém tente passar tenantId junto, o campo é ignorado.
    const input = { email, role: 'atendente', tenantId: seed.beta.id } as {
      email: string;
      role: string;
    };
    const invitation = await createInvitation(donoAlfa(), boss, input);
    expect(invitation.tenantId).toBe(seed.alfa.id);
    const rows = await owner.select().from(invitations).where(eq(invitations.email, email));
    expect(rows.map((r) => r.tenantId)).toEqual([seed.alfa.id]);
  });
});

describe('convites (16)', () => {
  it('convite de Alfa cria membership só em Alfa', async () => {
    const { token, email } = await invitationWithToken();
    const result = await acceptInvitation(token, { requestId: 'aceite', ip: null });
    expect(result.tenantId).toBe(seed.alfa.id);
    const rows = await owner.$client.query<{ tenant_id: string }>(
      'select m.tenant_id from memberships m join users u on u.id = m.user_id where lower(u.email) = $1',
      [email],
    );
    expect(rows.rows.map((r) => r.tenant_id)).toEqual([seed.alfa.id]);
    const audit = await owner
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'convite.aceito'));
    expect(audit.some((a) => a.tenantId === seed.alfa.id)).toBe(true);
  });

  it('segundo uso do mesmo token é recusado', async () => {
    const { token } = await invitationWithToken();
    await acceptInvitation(token, { requestId: 'aceite-1', ip: null });
    await expect(
      acceptInvitation(token, { requestId: 'aceite-2', ip: null }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
    expect((await securityEventsFor(owner, 'aceite-2'))[0]?.type).toBe('invitation_invalid');
  });

  it('aceites simultâneos: só um vence', async () => {
    const { token, invitation } = await invitationWithToken();
    const results = await Promise.allSettled([
      acceptInvitation(token, { requestId: 'c1', ip: null }),
      acceptInvitation(token, { requestId: 'c2', ip: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await owner.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(row!.acceptedAt).not.toBeNull();
  });

  it('convite expirado é recusado', async () => {
    const { token, invitation } = await invitationWithToken();
    await owner
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitation.id));
    await expect(acceptInvitation(token, { requestId: 'exp', ip: null })).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
  });

  it('convite revogado é recusado', async () => {
    const { token, invitation } = await invitationWithToken();
    await revokeInvitation(donoAlfa(), invitation.id);
    await expect(acceptInvitation(token, { requestId: 'rev', ip: null })).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
  });

  it('token inventado é recusado', async () => {
    await expect(
      acceptInvitation('token-inventado', { requestId: 'inv', ip: null }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
  });

  it('o banco guarda só o hash do token', async () => {
    const { token, invitation } = await invitationWithToken();
    const [row] = await owner.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('autorização por papel (17)', () => {
  it('admin não convida dono', async () => {
    const ctx = adminAlfa();
    await expect(
      createInvitation(ctx, boss, { email: uniqueEmail('x'), role: 'dono' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await securityEventsFor(owner, ctx.requestId))[0]?.type).toBe('forbidden');
  });

  it('contador e atendente não convidam', async () => {
    for (const ctx of [contadorAlfa(), atendenteAlfa()]) {
      await expect(
        createInvitation(ctx, boss, { email: uniqueEmail('x'), role: 'atendente' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('atendente não lista membros nem auditoria', async () => {
    await expect(listTeam(atendenteAlfa())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTenantAudit(atendenteAlfa())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('o último dono não pode ser rebaixado nem removido', async () => {
    const [donoRow] = await owner
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.tenantId, seed.beta.id), eq(memberships.userId, seed.users.donoBeta.id)),
      );
    const ctx = memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');
    await expect(changeMemberRole(ctx, donoRow!.id, 'admin')).rejects.toThrow('pelo menos um dono');
    await expect(removeMember(ctx, donoRow!.id)).rejects.toThrow('pelo menos um dono');
  });

  it('admin não altera dono', async () => {
    const [donoRow] = await owner
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.tenantId, seed.alfa.id), eq(memberships.userId, seed.users.donoAlfa.id)),
      );
    await expect(changeMemberRole(adminAlfa(), donoRow!.id, 'contador')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('dono altera papel e a auditoria registra', async () => {
    const { token, email } = await invitationWithToken();
    await acceptInvitation(token, { requestId: 'a', ip: null });
    const team = await listTeam(donoAlfa());
    const member = team.find((m) => m.email === email)!;
    const ctx = donoAlfa();
    await changeMemberRole(ctx, member.id, 'admin');
    const audit = await owner
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.requestId, ctx.requestId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'membro.papel_alterado', tenantId: seed.alfa.id });
  });
});
