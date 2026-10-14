/**
 * Jobs e fila (plano da Fundação, itens 21 a 23).
 */
import type { EmailMessage } from '@contab/adapters/email';
import { createInvitation } from '@contab/core';
import { withTenant } from '@contab/db';
import { createBoss, enqueue } from '@contab/db/queue';
import { invitations } from '@contab/db/schema';
import type { Db } from '@contab/db/testing';
import { defineJob, InvalidJobPayloadError } from '@contab/worker/define-job';
import { createJobs } from '@contab/worker/jobs';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { dbErrorMessage, memberCtx, ownerDb, systemCtx, uniqueEmail } from './helpers';

const seed = inject('seed');
let owner: Db;
let boss: PgBoss;

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

describe('envelope do job (21)', () => {
  it.each([
    ['sem tenantId', { invitationId: randomUUID() }],
    ['tenantId inválido', { tenantId: 'alfa', invitationId: randomUUID() }],
    ['payload vazio', null],
  ])('%s: falha antes do handler', async (_, data) => {
    let ran = false;
    const job = defineJob('invitation.send-email', async () => {
      ran = true;
    });
    await expect(job.run({ id: randomUUID(), data })).rejects.toBeInstanceOf(
      InvalidJobPayloadError,
    );
    expect(ran).toBe(false);
  });

  it('o handler roda dentro da transação do tenant do payload', async () => {
    let seen: string | null = null;
    const job = defineJob('invitation.send-email', async (tx) => {
      const r = await tx.execute<{ t: string }>(sql`select app_current_tenant_id() as t`);
      seen = r.rows[0]!.t;
    });
    await job.run({
      id: randomUUID(),
      data: { tenantId: seed.beta.id, invitationId: randomUUID() },
    });
    expect(seen).toBe(seed.beta.id);
  });
});

describe('job com tenant errado (22)', () => {
  it('job de Alfa não grava em Beta: o RLS bloqueia', async () => {
    const job = defineJob('invitation.send-email', async (tx) => {
      await tx.insert(invitations).values({
        tenantId: seed.beta.id,
        id: randomUUID(),
        email: 'job@exemplo.test',
        role: 'atendente',
        expiresAt: new Date(Date.now() + 3600_000),
      });
    });
    expect(
      await dbErrorMessage(
        job.run({ id: randomUUID(), data: { tenantId: seed.alfa.id, invitationId: randomUUID() } }),
      ),
    ).toMatch(/row-level security/);
  });

  it('job de Alfa não lê convite de Beta', async () => {
    const betaInvitation = await createInvitation(
      memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono'),
      boss,
      { email: uniqueEmail('beta'), role: 'atendente' },
    );
    const sent: EmailMessage[] = [];
    const [sendJob] = createJobs({
      email: { send: async (m) => void sent.push(m) },
      painelUrl: 'http://app.localhost:3000',
    });
    await expect(
      sendJob!.run({
        id: randomUUID(),
        data: { tenantId: seed.alfa.id, invitationId: betaInvitation.id },
      }),
    ).rejects.toThrow(/invitation não encontrado/);
    expect(sent).toHaveLength(0);
  });
});

describe('enfileirar (23)', () => {
  it('o payload na fila sempre leva o tenant do contexto', async () => {
    const ctx = systemCtx(seed.alfa.id);
    const id = await withTenant(ctx, (tx) =>
      // Mesmo que alguém tente enfiar outro tenant no payload, o contexto vence.
      enqueue(boss, ctx, tx, 'invitation.send-email', {
        invitationId: randomUUID(),
        tenantId: seed.beta.id,
      } as { invitationId: string }),
    );
    const { rows } = await owner.$client.query<{ data: { tenantId: string } }>(
      'select data from pgboss.job where id = $1',
      [id],
    );
    expect(rows[0]?.data.tenantId).toBe(seed.alfa.id);
  });

  it('se a transação desfizer, o job some junto', async () => {
    const ctx = systemCtx(seed.alfa.id);
    const marker = randomUUID();
    await expect(
      withTenant(ctx, async (tx) => {
        await enqueue(boss, ctx, tx, 'invitation.send-email', { invitationId: marker });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');
    const { rows } = await owner.$client.query(
      "select id from pgboss.job where data->>'invitationId' = $1",
      [marker],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('envio do convite', () => {
  it('gera o token no job, grava só o hash e manda o link por e-mail', async () => {
    const email = uniqueEmail('envio');
    const invitation = await createInvitation(
      memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono'),
      boss,
      {
        email,
        role: 'contador',
      },
    );
    const sent: EmailMessage[] = [];
    const [sendJob] = createJobs({
      email: { send: async (m) => void sent.push(m) },
      painelUrl: 'http://app.localhost:3000',
    });
    await sendJob!.run({
      id: randomUUID(),
      data: { tenantId: seed.alfa.id, invitationId: invitation.id },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    const token = sent[0]!.text.match(/\/convite\/([A-Za-z0-9_-]+)/)![1]!;
    const [row] = await owner.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.tokenHash).not.toContain(token);
  });

  it('se o e-mail falhar, o token não é gravado (a transação desfaz e o job tenta de novo)', async () => {
    const invitation = await createInvitation(
      memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono'),
      boss,
      {
        email: uniqueEmail('falha'),
        role: 'contador',
      },
    );
    const [sendJob] = createJobs({
      email: {
        send: async () => {
          throw new Error('provedor fora do ar');
        },
      },
      painelUrl: 'http://app.localhost:3000',
    });
    await expect(
      sendJob!.run({
        id: randomUUID(),
        data: { tenantId: seed.alfa.id, invitationId: invitation.id },
      }),
    ).rejects.toThrow('provedor fora do ar');
    const [row] = await owner.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(row!.tokenHash).toBeNull();
  });
});
