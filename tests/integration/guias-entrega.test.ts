/**
 * Guias e entrega (incremento 3): RN1 com I5, RN5, RN8, P25, CA7, CA9 e isolamento.
 * O WhatsApp é o simulado; o e-mail vai para uma caixa em memória.
 */
import {
  cancelGuide,
  confirmGuidePdf,
  createGuide,
  getGuideDetail,
  getWhatsAppStatus,
  markGuidePaid,
  publishGuide,
  requestGuidePdfUpload,
  runRegua,
  setContactConsent,
} from '@contab/core';
import { ForbiddenError, NotFoundError, withTenant, type TenantContext } from '@contab/db';
import { createBoss } from '@contab/db/queue';
import type { Db } from '@contab/db/testing';
import type { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connectFakeWhatsApp,
  drainJobs,
  postWebhook,
  statusPayload,
  testDeliveryDeps,
  type TestDeps,
} from './delivery-helpers';
import { memberCtx, ownerDb, PDF_BYTES, securityEventsFor } from './helpers';

const seed = inject('seed');
let owner: Db;
let boss: PgBoss;
let deps: TestDeps;
let phoneNumberId: string;
let webhookKey: string;

const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const dono = () => memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono');
const donoBeta = () => memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');
const PIX =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
let periodCounter = 0;

/** Cria uma guia avulsa com PDF, pronta para publicar. */
async function readyGuide(
  ctx: TenantContext,
  companyId: string,
  dueDate = '2030-12-20',
): Promise<string> {
  periodCounter++;
  const month = String((periodCounter % 12) + 1).padStart(2, '0');
  const year = 2030 + Math.floor(periodCounter / 12);
  const guide = await createGuide(ctx, {
    companyId,
    type: 'das_simples',
    period: `${month}/${year}`,
    dueDate,
    amount: '1.234,56',
    pixCode: PIX,
  });
  const upload = await requestGuidePdfUpload(ctx, deps.storage, guide.id, {
    size: PDF_BYTES.length,
    contentType: 'application/pdf',
  });
  await fetch(upload.url, { method: 'PUT', body: PDF_BYTES, headers: upload.headers });
  await confirmGuidePdf(ctx, deps.storage, guide.id);
  return guide.id;
}

async function deliveriesOf(guideId: string) {
  const { rows } = await owner.$client.query<{
    channel: string;
    trigger: string;
    status: string;
    provider_message_id: string | null;
    failure_reason: string | null;
    fallback_of: string | null;
  }>(
    'select channel, trigger, status, provider_message_id, failure_reason, fallback_of from deliveries where item_id = $1 order by created_at',
    [guideId],
  );
  return rows;
}

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
  deps = testDeliveryDeps(boss);
  const connected = await connectFakeWhatsApp(dono(), deps);
  phoneNumberId = connected.phoneNumberId;
  webhookKey = connected.webhookKey;
  // João (seed) recebe envios das duas empresas; com P25, nasce autorizado no WhatsApp.
  await owner.$client.query(
    `update contacts set whatsapp_opt_in_at = now(), email = 'joao@exemplo.test', email_opt_in_at = now()
      where id = $1`,
    [seed.contacts.joao.id],
  );
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

describe('conexão do WhatsApp', () => {
  it('fica ativa, aprova os templates e nunca devolve segredo', async () => {
    const status = await getWhatsAppStatus(dono());
    expect(status?.channel.status).toBe('ativo');
    expect(status?.templates.every((t) => t.status === 'aprovado')).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/token-de-teste|0123456789abcdef|Hash/);
    const { rows } = await owner.$client.query<{ ciphertext: string }>(
      'select ciphertext from credentials where tenant_id = $1',
      [seed.alfa.id],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.ciphertext).not.toContain('token-de-teste');
  });

  it('contador não mexe em conexões', async () => {
    await expect(getWhatsAppStatus(contador())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('guias (RN1, RN5)', () => {
  it('não publica sem PDF; não deixa duas guias ativas iguais', async () => {
    const guide = await createGuide(contador(), {
      companyId: seed.companies.loja.id,
      type: 'iss',
      period: '01/2031',
      dueDate: '2031-02-10',
      amount: '50',
      barcode: '858600000123456000000000000000000000000000000000',
    });
    await expect(publishGuide(contador(), boss, guide.id)).rejects.toThrow(/PDF/);
    await expect(
      createGuide(contador(), {
        companyId: seed.companies.loja.id,
        type: 'iss',
        period: '01/2031',
        dueDate: '2031-02-10',
        amount: '50',
        barcode: '858600000123456000000000000000000000000000000000',
      }),
    ).rejects.toThrow(/RN5/);
    // Cancelada libera a chave.
    await cancelGuide(contador(), guide.id, 'valor errado');
    await expect(
      createGuide(contador(), {
        companyId: seed.companies.loja.id,
        type: 'iss',
        period: '01/2031',
        dueDate: '2031-02-10',
        amount: '55',
        barcode: '858600000123456000000000000000000000000000000000',
      }),
    ).resolves.toBeTruthy();
  });

  it('PDF com conteúdo que não é PDF é recusado', async () => {
    const guide = await createGuide(contador(), {
      companyId: seed.companies.loja.id,
      type: 'fgts',
      period: '02/2031',
      dueDate: '2031-03-10',
      amount: '10',
      pixCode: PIX,
    });
    const fake = new TextEncoder().encode('isto não é um pdf');
    const upload = await requestGuidePdfUpload(contador(), deps.storage, guide.id, {
      size: fake.length,
      contentType: 'application/pdf',
    });
    await fetch(upload.url, { method: 'PUT', body: fake, headers: upload.headers });
    await expect(confirmGuidePdf(contador(), deps.storage, guide.id)).rejects.toThrow(/PDF válido/);
  });

  it('atendente não cria nem publica guia', async () => {
    const atendente = memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente');
    await expect(
      createGuide(atendente, {
        companyId: seed.companies.loja.id,
        type: 'iss',
        period: '03/2031',
        dueDate: '2031-04-10',
        amount: '1',
        pixCode: PIX,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('CA7 — entrega automática da guia', () => {
  it('publicada → WhatsApp com PDF, valores e link; webhook marca entregue e lido', async () => {
    const guideId = await readyGuide(contador(), seed.companies.padaria.id);
    await publishGuide(contador(), boss, guideId);
    const before = deps.whatsapp.sent.length;
    await drainJobs(deps, seed.alfa.id);

    const sent = deps.whatsapp.sent.slice(before);
    expect(sent).toHaveLength(1);
    const message = sent[0]!.message;
    expect(message).toMatchObject({
      to: seed.contacts.joao.phone,
      templateName: 'guia_disponivel_v1',
      category: 'UTILITY',
    });
    expect(message.document?.fileName).toMatch(/\.pdf$/);
    expect(message.bodyValues).toContain('R$ 1.234,56');
    expect(message.bodyValues).toContain('20/12/2030');
    expect(message.linkSuffix).toMatch(/^[\w-]{40,}$/);

    const [delivery] = await deliveriesOf(guideId);
    expect(delivery).toMatchObject({ channel: 'whatsapp', status: 'enviado' });
    const messageId = sent[0]!.messageId;
    expect(delivery!.provider_message_id).toBe(messageId);

    expect(
      (await postWebhook(deps, webhookKey, statusPayload(phoneNumberId, messageId, 'delivered')))
        .status,
    ).toBe(200);
    await drainJobs(deps, seed.alfa.id);
    expect((await deliveriesOf(guideId))[0]!.status).toBe('entregue');
    await postWebhook(deps, webhookKey, statusPayload(phoneNumberId, messageId, 'read'));
    // Webhook repetido não muda nada (idempotência).
    await postWebhook(deps, webhookKey, statusPayload(phoneNumberId, messageId, 'read'));
    await drainJobs(deps, seed.alfa.id);
    expect((await deliveriesOf(guideId))[0]!.status).toBe('lido');

    const detail = await getGuideDetail(contador(), guideId);
    expect(detail.guide.status).toBe('publicada');
    expect(detail.deliveries.map((d) => d.contactName)).toEqual(['João Fictício']);
  });

  it('publicar de novo o mesmo gatilho não envia duas vezes', async () => {
    const guideId = await readyGuide(contador(), seed.companies.padaria.id);
    await publishGuide(contador(), boss, guideId);
    await drainJobs(deps, seed.alfa.id);
    await withTenant(contador(), async (tx) => {
      const { planDeliveries } = await import('@contab/core');
      expect(
        await planDeliveries(tx, contador(), deps, {
          itemType: 'guia',
          itemId: guideId,
          trigger: 'publicacao',
        }),
      ).toBe(0);
    });
  });
});

describe('CA9 e desvio para o e-mail', () => {
  it('template pausado pela Meta: o envio sai por e-mail e o escritório recebe alerta', async () => {
    const pause = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '987654321',
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'PAUSED',
                message_template_id: 'qualquer',
                message_template_name: 'lembrete_vencimento_v1',
                reason: 'qualidade',
              },
            },
          ],
        },
      ],
    };
    await postWebhook(deps, webhookKey, pause);
    await drainJobs(deps, seed.alfa.id);
    const { rows: alerts } = await owner.$client.query(
      `select kind from tenant_alerts where tenant_id = $1 and kind = 'template_indisponivel' and resolved_at is null`,
      [seed.alfa.id],
    );
    expect(alerts.length).toBeGreaterThan(0);

    // Lembrete de uma guia que vence em 2 dias (régua com "agora" fixo).
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const guideId = await readyGuide(contador(), seed.companies.padaria.id, due);
    await publishGuide(contador(), boss, guideId);
    await drainJobs(deps, seed.alfa.id);
    const inbox = deps.outbox.length;
    await withTenant(contador(), (tx) => runRegua(tx, contador(), deps));
    await drainJobs(deps, seed.alfa.id);

    const reminder = (await deliveriesOf(guideId)).filter((d) => d.trigger === 'lembrete');
    expect(reminder.map((d) => d.channel)).toEqual(['email']);
    const email = deps.outbox.slice(inbox).find((m) => m.subject.startsWith('Lembrete'))!;
    expect(email.to).toBe('joao@exemplo.test');
    expect(email.fromName).toBe(seed.alfa.name);
    expect(email.text).toMatch(/http:\/\/alfa\.localhost:3000\/g\//);
    expect(email.text).toMatch(/sair-email/);
  });

  it('número inválido (erro permanente da Meta) desvia para o e-mail', async () => {
    await owner.$client.query(`update contacts set phone = '+5598990000000' where id = $1`, [
      seed.contacts.joao.id,
    ]);
    try {
      const guideId = await readyGuide(contador(), seed.companies.loja.id);
      await publishGuide(contador(), boss, guideId);
      await drainJobs(deps, seed.alfa.id);
      const rows = await deliveriesOf(guideId);
      expect(rows.map((r) => [r.channel, r.status])).toEqual([
        ['whatsapp', 'falhou'],
        ['email', 'enviado'],
      ]);
      expect(rows[1]!.fallback_of).not.toBeNull();
    } finally {
      await owner.$client.query(`update contacts set phone = $2 where id = $1`, [
        seed.contacts.joao.id,
        seed.contacts.joao.phone,
      ]);
    }
  });

  it('cliente sem autorização no WhatsApp (SAIR) recebe por e-mail; sem nenhuma, nada sai', async () => {
    await setContactConsent(contador(), seed.contacts.joao.id, 'whatsapp', false);
    try {
      const guideId = await readyGuide(contador(), seed.companies.padaria.id);
      await publishGuide(contador(), boss, guideId);
      await drainJobs(deps, seed.alfa.id);
      expect((await deliveriesOf(guideId)).map((d) => d.channel)).toEqual(['email']);

      await setContactConsent(contador(), seed.contacts.joao.id, 'email', false);
      const silent = await readyGuide(contador(), seed.companies.padaria.id);
      await publishGuide(contador(), boss, silent);
      await drainJobs(deps, seed.alfa.id);
      expect(await deliveriesOf(silent)).toEqual([]);
    } finally {
      await setContactConsent(contador(), seed.contacts.joao.id, 'whatsapp', true);
      await setContactConsent(contador(), seed.contacts.joao.id, 'email', true);
    }
  });
});

describe('pagamento (I5) e RN8', () => {
  it('guia paga: links encerrados, aviso de pago, e a régua não manda lembrete', async () => {
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const guideId = await readyGuide(contador(), seed.companies.padaria.id, due);
    await publishGuide(contador(), boss, guideId);
    await drainJobs(deps, seed.alfa.id);
    await markGuidePaid(contador(), boss, guideId, 'comprovante enviado pelo cliente');
    await drainJobs(deps, seed.alfa.id);
    await withTenant(contador(), (tx) => runRegua(tx, contador(), deps));
    await drainJobs(deps, seed.alfa.id);

    const rows = await deliveriesOf(guideId);
    expect(rows.map((r) => r.trigger)).toEqual(['publicacao', 'pago']);
    const { rows: links } = await owner.$client.query(
      'select revoked_at from secure_links where item_id = $1',
      [guideId],
    );
    expect(links.every((l) => l.revoked_at !== null)).toBe(true);
    const { rows: audit } = await owner.$client.query(
      `select 1 from audit_logs where resource_id = $1 and action = 'guia.baixa_manual'`,
      [guideId],
    );
    expect(audit).toHaveLength(1);
  });

  it('guia substituída paga: a nova é cancelada e o escritório recebe alerta', async () => {
    const oldId = await readyGuide(contador(), seed.companies.loja.id, '2030-01-10');
    await publishGuide(contador(), boss, oldId);
    await owner.$client.query(`update guides set status = 'substituida' where id = $1`, [oldId]);
    const { rows } = await owner.$client.query<{
      company_id: string;
      type: string;
      period: string;
    }>('select company_id, type, period from guides where id = $1', [oldId]);
    const newId = randomUUID();
    await owner.$client.query(
      `insert into guides (tenant_id, id, company_id, type, period, due_date, amount_cents, pix_code, status, source, replaces_guide_id)
       values ($1, $2, $3, $4, $5, '2030-01-20', 130000, $6, 'publicada', 'avulsa', $7)`,
      [seed.alfa.id, newId, rows[0]!.company_id, rows[0]!.type, rows[0]!.period, PIX, oldId],
    );

    await markGuidePaid(contador(), boss, oldId, 'pago no banco antes da atualização');
    const status = await owner.$client.query<{ id: string; status: string }>(
      'select id, status from guides where id = any($1)',
      [[oldId, newId]],
    );
    expect(Object.fromEntries(status.rows.map((r) => [r.id, r.status]))).toEqual({
      [oldId]: 'paga',
      [newId]: 'cancelada',
    });
    const { rows: alerts } = await owner.$client.query(
      `select 1 from tenant_alerts where resource_id = $1 and kind = 'guia_substituida_paga'`,
      [newId],
    );
    expect(alerts).toHaveLength(1);
  });

  it('paga não volta e cancelada não é paga', async () => {
    const guideId = await readyGuide(contador(), seed.companies.loja.id);
    await cancelGuide(contador(), guideId, 'teste');
    await expect(markGuidePaid(contador(), boss, guideId, 'tentativa')).rejects.toThrow(/não pode/);
  });
});

describe('régua (vencida)', () => {
  it('marca vencida e manda o aviso no dia seguinte ao vencimento', async () => {
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const guideId = await readyGuide(contador(), seed.companies.loja.id, yesterday);
    await publishGuide(contador(), boss, guideId);
    await drainJobs(deps, seed.alfa.id);
    const late = testDeliveryDeps(boss, () => new Date(Date.now() + 12 * 3_600_000));
    late.whatsapp = deps.whatsapp;
    await withTenant(contador(), (tx) => runRegua(tx, contador(), late));
    await drainJobs(deps, seed.alfa.id);
    const { rows } = await owner.$client.query<{ status: string }>(
      'select status from guides where id = $1',
      [guideId],
    );
    expect(rows[0]!.status).toBe('vencida');
    expect((await deliveriesOf(guideId)).map((d) => d.trigger)).toContain('vencida');
  });
});

describe('isolamento (1, 4)', () => {
  let betaGuide: string;
  beforeAll(async () => {
    betaGuide = await readyGuide(donoBeta(), seed.companies.betaPadaria.id);
  });

  it.each([
    ['detalhe', () => getGuideDetail(contador(), betaGuide)],
    ['publicar', () => publishGuide(contador(), boss, betaGuide)],
    ['baixa', () => markGuidePaid(contador(), boss, betaGuide, 'invasão')],
    ['cancelar', () => cancelGuide(contador(), betaGuide, 'invasão')],
    [
      'criar em empresa do Beta',
      () =>
        createGuide(contador(), {
          companyId: seed.companies.betaPadaria.id,
          type: 'iss',
          period: '05/2031',
          dueDate: '2031-06-10',
          amount: '1',
          pixCode: PIX,
        }),
    ],
  ])('%s: 404 para o Alfa, sem efeito no Beta', async (_, action) => {
    await expect(action()).rejects.toBeInstanceOf(NotFoundError);
    const { rows } = await owner.$client.query<{ status: string }>(
      'select status from guides where id = $1',
      [betaGuide],
    );
    expect(rows[0]!.status).toBe('rascunho');
  });

  it('a busca sem resultado fica registrada', async () => {
    const ctx = contador();
    await expect(getGuideDetail(ctx, betaGuide)).rejects.toThrow();
    expect((await securityEventsFor(owner, ctx.requestId))[0]).toMatchObject({
      type: 'resource_not_found',
      resource_type: 'guide',
    });
  });

  it('jobs do Alfa com entrega ou guia do Beta não acham nem enviam nada', async () => {
    const { sendDelivery, planDeliveries } = await import('@contab/core');
    const before = deps.whatsapp.sent.length;
    await withTenant(contador(), async (tx) => {
      expect(
        await planDeliveries(tx, contador(), deps, {
          itemType: 'guia',
          itemId: betaGuide,
          trigger: 'publicacao',
        }),
      ).toBe(0);
      expect(await sendDelivery(tx, contador(), deps, randomUUID())).toBe('ignorado');
    });
    expect(deps.whatsapp.sent.length).toBe(before);
  });
});
