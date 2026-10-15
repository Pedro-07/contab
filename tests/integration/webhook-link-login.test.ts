/**
 * Webhook (I2), link seguro (RN14), descadastro de e-mail (RN7), login do portal (P3) e
 * despacho da régua (job da plataforma). Testes 2, 3, 5 e 7 da seção 9 do plano.
 */
import {
  confirmGuidePdf,
  createGuide,
  emailOptOutToken,
  getSecureLinkPdfUrl,
  hashLinkToken,
  isOptOutText,
  markGuidePaid,
  openSecureLink,
  optOutEmailByLink,
  publishGuide,
  readPortalSession,
  receiveWhatsAppWebhook,
  requestGuidePdfUpload,
  requestPortalCode,
  verifyPortalCode,
  verifyWhatsAppSubscription,
} from '@contab/core';
import { createBoss } from '@contab/db/queue';
import type { Db } from '@contab/db/testing';
import { dispatchRegua } from '@contab/worker/jobs/platform';
import type { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connectFakeWhatsApp,
  drainJobs,
  postWebhook,
  testDeliveryDeps,
  type TestDeps,
} from './delivery-helpers';
import { memberCtx, ownerDb, PDF_BYTES, securityEventsFor } from './helpers';

const seed = inject('seed');
let owner: Db;
let boss: PgBoss;
let deps: TestDeps;
let alfa: Awaited<ReturnType<typeof connectFakeWhatsApp>>;
let beta: Awaited<ReturnType<typeof connectFakeWhatsApp>>;
const meta = () => ({ requestId: `teste-${randomUUID()}`, ip: '10.1.2.3' });
const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const PIX =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
  deps = testDeliveryDeps(boss);
  alfa = await connectFakeWhatsApp(memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono'), deps);
  beta = await connectFakeWhatsApp(memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono'), deps);
  await owner.$client.query(`update contacts set whatsapp_opt_in_at = now() where id = any($1)`, [
    [seed.contacts.joao.id, seed.contacts.joaoBeta.id],
  ]);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

function messagePayload(phoneNumberId: string, from: string, text: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '987654321',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ id: `wamid.${randomUUID()}`, from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

describe('webhook (I2, teste 3)', () => {
  it('chave desconhecida: 404 e evento de segurança', async () => {
    const m = meta();
    expect((await receiveWhatsAppWebhook('nao-existe', '{}', null, deps, m)).status).toBe(404);
    expect((await securityEventsFor(owner, m.requestId))[0]?.type).toBe(
      'webhook_signature_invalid',
    );
  });

  it('assinatura inválida: 401, nada gravado', async () => {
    const raw = JSON.stringify(messagePayload(alfa.phoneNumberId, '5598990000001', 'SAIR'));
    const m = meta();
    const res = await receiveWhatsAppWebhook(alfa.webhookKey, raw, 'sha256=00', deps, m);
    expect(res.status).toBe(401);
    expect((await securityEventsFor(owner, m.requestId))[0]?.type).toBe(
      'webhook_signature_invalid',
    );
  });

  it('número do Alfa na URL do Beta: recusado, nada gravado no Beta', async () => {
    const before = await owner.$client.query(
      'select count(*)::int as n from webhook_events where tenant_id = $1',
      [seed.beta.id],
    );
    const res = await postWebhook(
      deps,
      beta.webhookKey,
      messagePayload(alfa.phoneNumberId, '5598990000001', 'SAIR'),
    );
    expect(res.status).toBe(200);
    const after = await owner.$client.query(
      'select count(*)::int as n from webhook_events where tenant_id = $1',
      [seed.beta.id],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('desafio de assinatura: só com o verify token da conexão', async () => {
    expect(
      await verifyWhatsAppSubscription(
        alfa.webhookKey,
        { mode: 'subscribe', token: alfa.verifyToken, challenge: '42' },
        meta(),
      ),
    ).toBe('42');
    expect(
      await verifyWhatsAppSubscription(
        alfa.webhookKey,
        { mode: 'subscribe', token: beta.verifyToken, challenge: '42' },
        meta(),
      ),
    ).toBeNull();
  });

  it('"SAIR" desliga o WhatsApp na hora (RN7), sem guardar o texto', async () => {
    expect(isOptOutText(' Sair! ')).toBe(true);
    expect(isOptOutText('quero sair do grupo')).toBe(false);
    await postWebhook(
      deps,
      alfa.webhookKey,
      messagePayload(alfa.phoneNumberId, '5598990000001', 'Sair'),
    );
    await drainJobs(deps, seed.alfa.id);
    const { rows } = await owner.$client.query<{ w: Date | null }>(
      'select whatsapp_opt_in_at as w from contacts where id = $1',
      [seed.contacts.joao.id],
    );
    expect(rows[0]!.w).toBeNull();
    const { rows: consent } = await owner.$client.query<{ source: string }>(
      `select source from contact_consents where contact_id = $1 order by occurred_at desc limit 1`,
      [seed.contacts.joao.id],
    );
    expect(consent[0]!.source).toBe('cliente');
    const { rows: stored } = await owner.$client.query<{ payload: unknown }>(
      `select payload from webhook_events where tenant_id = $1 and kind = 'message'`,
      [seed.alfa.id],
    );
    expect(JSON.stringify(stored)).not.toMatch(/Sair/i);
    // O João do Beta continua autorizado.
    const { rows: betaJoao } = await owner.$client.query<{ w: Date | null }>(
      'select whatsapp_opt_in_at as w from contacts where id = $1',
      [seed.contacts.joaoBeta.id],
    );
    expect(betaJoao[0]!.w).not.toBeNull();
    await owner.$client.query(`update contacts set whatsapp_opt_in_at = now() where id = $1`, [
      seed.contacts.joao.id,
    ]);
  });
});

describe('link seguro (RN14, teste 2)', () => {
  async function publishedLink(): Promise<{ guideId: string; token: string }> {
    const guide = await createGuide(contador(), {
      companyId: seed.companies.padaria.id,
      type: 'darf',
      period: `${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}/${2040 + Math.floor(Math.random() * 50)}`,
      dueDate: '2040-12-20',
      amount: '99,90',
      pixCode: PIX,
    });
    const up = await requestGuidePdfUpload(contador(), deps.storage, guide.id, {
      size: PDF_BYTES.length,
      contentType: 'application/pdf',
    });
    await fetch(up.url, { method: 'PUT', body: PDF_BYTES, headers: up.headers });
    await confirmGuidePdf(contador(), deps.storage, guide.id);
    const before = deps.whatsapp.sent.length;
    await publishGuide(contador(), boss, guide.id);
    await drainJobs(deps, seed.alfa.id);
    const token = deps.whatsapp.sent.slice(before)[0]!.message.linkSuffix!;
    return { guideId: guide.id, token };
  }

  it('abre no escritório certo, mostra Pix e PDF e conta a abertura', async () => {
    const { token } = await publishedLink();
    const view = await openSecureLink(seed.alfa.id, token, meta());
    expect(view).toMatchObject({ state: 'ok', pixCode: PIX, amountCents: 9990, hasPdf: true });
    expect(await getSecureLinkPdfUrl(seed.alfa.id, token, deps.storage, meta())).toContain('X-Amz');
    const { rows } = await owner.$client.query<{ access_count: number }>(
      'select access_count from secure_links where token_hash = $1',
      [hashLinkToken(token)],
    );
    expect(rows[0]!.access_count).toBe(1);
    const { rows: accesses } = await owner.$client.query(
      'select ip from secure_link_accesses a join secure_links l on l.id = a.link_id where l.token_hash = $1',
      [hashLinkToken(token)],
    );
    expect(accesses).toHaveLength(1);
  });

  it('link do Alfa aberto no endereço do Beta não existe', async () => {
    const { token } = await publishedLink();
    const m = meta();
    expect(await openSecureLink(seed.beta.id, token, m)).toEqual({ state: 'invalido' });
    expect(await getSecureLinkPdfUrl(seed.beta.id, token, deps.storage, meta())).toBeNull();
    expect((await securityEventsFor(owner, m.requestId))[0]?.resource_type).toBe('secure_link');
  });

  it('expira, tem limite de aberturas e para quando a guia é paga', async () => {
    const a = await publishedLink();
    await owner.$client.query(
      `update secure_links set expires_at = now() - interval '1 minute' where token_hash = $1`,
      [hashLinkToken(a.token)],
    );
    expect((await openSecureLink(seed.alfa.id, a.token, meta())).state).toBe('expirado');

    const b = await publishedLink();
    await owner.$client.query(
      `update secure_links set access_count = max_accesses where token_hash = $1`,
      [hashLinkToken(b.token)],
    );
    expect((await openSecureLink(seed.alfa.id, b.token, meta())).state).toBe('limite');

    const c = await publishedLink();
    await markGuidePaid(contador(), boss, c.guideId, 'pago');
    expect((await openSecureLink(seed.alfa.id, c.token, meta())).state).toBe('paga');
    expect(await getSecureLinkPdfUrl(seed.alfa.id, c.token, deps.storage, meta())).toBeNull();
  });
});

describe('descadastro do e-mail (RN7)', () => {
  it('o link assinado desliga o e-mail; adulterado ou de outro escritório não', async () => {
    await owner.$client.query(
      `update contacts set email = 'joao@exemplo.test', email_opt_in_at = now() where id = $1`,
      [seed.contacts.joao.id],
    );
    const token = emailOptOutToken(
      process.env.BETTER_AUTH_SECRET!,
      seed.alfa.id,
      seed.contacts.joao.id,
    );
    expect(
      await optOutEmailByLink(seed.beta.id, token, process.env.BETTER_AUTH_SECRET!, meta()),
    ).toBe(false);
    expect(
      await optOutEmailByLink(seed.alfa.id, `${token}x`, process.env.BETTER_AUTH_SECRET!, meta()),
    ).toBe(false);
    expect(
      await optOutEmailByLink(seed.alfa.id, token, process.env.BETTER_AUTH_SECRET!, meta()),
    ).toBe(true);
    const { rows } = await owner.$client.query<{ e: Date | null }>(
      'select email_opt_in_at as e from contacts where id = $1',
      [seed.contacts.joao.id],
    );
    expect(rows[0]!.e).toBeNull();
  });
});

describe('login do portal por código (P3, teste 7)', () => {
  it('manda o código pelo WhatsApp, abre a sessão e o código vale uma vez', async () => {
    const before = deps.whatsapp.sent.length;
    await requestPortalCode(seed.alfa.id, '(98) 99000-0001', deps, meta());
    const sent = deps.whatsapp.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.templateName).toBe('codigo_acesso_v1');
    const code = sent[0]!.message.bodyValues[0]!;

    // Código do Alfa não vale no Beta (o João do Beta tem o mesmo telefone).
    expect(await verifyPortalCode(seed.beta.id, '98990000001', code, meta())).toBeNull();
    const token = await verifyPortalCode(seed.alfa.id, '98990000001', code, meta());
    expect(token).toBeTruthy();
    const session = await readPortalSession(seed.alfa.id, token!, meta());
    expect(session?.companies).toHaveLength(2);
    expect(await verifyPortalCode(seed.alfa.id, '98990000001', code, meta())).toBeNull();
    const { rows } = await owner.$client.query(
      'select 1 from portal_login_codes where code_hash = $1',
      [code],
    );
    expect(rows).toHaveLength(0);
  });

  it('5 tentativas erradas bloqueiam o código', async () => {
    const before = deps.whatsapp.sent.length;
    await requestPortalCode(seed.alfa.id, '98990000001', deps, meta());
    const code = deps.whatsapp.sent.slice(before)[0]!.message.bodyValues[0]!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(await verifyPortalCode(seed.alfa.id, '98990000001', wrong, meta())).toBeNull();
    }
    expect(await verifyPortalCode(seed.alfa.id, '98990000001', code, meta())).toBeNull();
  });

  it('telefone sem acesso não recebe nada e a resposta é a mesma', async () => {
    const before = deps.whatsapp.sent.length;
    const m = meta();
    await expect(requestPortalCode(seed.alfa.id, '98991234567', deps, m)).resolves.toBeUndefined();
    expect(deps.whatsapp.sent.length).toBe(before);
    expect((await securityEventsFor(owner, m.requestId))[0]?.type).toBe('login_failed');
  });
});

describe('despacho da régua (job da plataforma, teste 5)', () => {
  it('enfileira um regua.tenant por escritório ativo, só uma vez por janela', async () => {
    expect(await dispatchRegua(boss)).toBeGreaterThanOrEqual(2);
    await dispatchRegua(boss);
    const jobs = await boss.fetch<{ tenantId: string }>('regua.tenant', { batchSize: 100 });
    const tenants = jobs.map((j) => j.data.tenantId);
    expect(tenants.filter((t) => t === seed.alfa.id)).toHaveLength(1);
    expect(tenants.filter((t) => t === seed.beta.id)).toHaveLength(1);
    for (const j of jobs) await boss.complete('regua.tenant', j.id);
  });
});
