/**
 * Portal (incremento 2, D1; testes 6, 7 e 8 da seção 8; CA6).
 * João é sócio da Padaria e da Loja no Alfa e tem um cadastro separado no Beta.
 */
import {
  createPortalDevLink,
  getPortalDocumentDownloadUrl,
  listPortalDocuments,
  portalDevLoginAllowed,
  readPortalSession,
  redeemPortalDevLink,
  setPortalAccess,
  signOutPortal,
  switchPortalCompany,
} from '@contab/core';
import { NotFoundError } from '@contab/db';
import { createBoss } from '@contab/db/queue';
import type { Db } from '@contab/db/testing';
import type { TenantId } from '@contab/domain';
import type { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { memberCtx, ownerDb, securityEventsFor, testStorage, uploadTestDocument } from './helpers';

const seed = inject('seed');
const storage = testStorage();
let owner: Db;
let boss: PgBoss;
let docs: { padaria: string; loja: string; padariaOculto: string; beta: string };

const meta = () => ({ requestId: `teste-${randomUUID()}`, ip: '127.0.0.1' });
const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');

async function login(tenantId: TenantId, contactId: string): Promise<string> {
  const link = await createPortalDevLink('test', tenantId, contactId, meta());
  const session = await redeemPortalDevLink('test', tenantId, link, meta());
  if (!session) throw new Error('sem sessão');
  return session;
}

async function state(tenantId: TenantId, token: string) {
  const s = await readPortalSession(tenantId, token, meta());
  if (!s) throw new Error('sessão inválida');
  return s;
}

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
  const up = (companyId: string, visibleToClient = true) =>
    uploadTestDocument(contador(), boss, { companyId, visibleToClient }).then((d) => d.documentId);
  docs = {
    padaria: await up(seed.companies.padaria.id),
    loja: await up(seed.companies.loja.id),
    padariaOculto: await up(seed.companies.padaria.id, false),
    beta: (
      await uploadTestDocument(memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono'), boss, {
        companyId: seed.companies.betaPadaria.id,
      })
    ).documentId,
  };
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

describe('entrada de desenvolvimento (D1)', () => {
  it('o link vale uma vez e não vira o token da sessão', async () => {
    const link = await createPortalDevLink('test', seed.alfa.id, seed.contacts.joao.id, meta());
    const session = await redeemPortalDevLink('test', seed.alfa.id, link, meta());
    expect(session).toBeTruthy();
    expect(session).not.toBe(link);

    const again = meta();
    expect(await redeemPortalDevLink('test', seed.alfa.id, link, again)).toBeNull();
    expect((await securityEventsFor(owner, again.requestId))[0]?.type).toBe('login_failed');
    expect(await readPortalSession(seed.alfa.id, link, meta())).toBeNull();
  });

  it('fica desligado em staging e produção', async () => {
    expect(portalDevLoginAllowed('production')).toBe(false);
    expect(portalDevLoginAllowed('staging')).toBe(false);
    await expect(
      createPortalDevLink('production', seed.alfa.id, seed.contacts.joao.id, meta()),
    ).rejects.toThrow();
    const link = await createPortalDevLink('test', seed.alfa.id, seed.contacts.joao.id, meta());
    expect(await redeemPortalDevLink('staging', seed.alfa.id, link, meta())).toBeNull();
  });

  it('só guarda o hash do token', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    const { rows } = await owner.$client.query(
      'select 1 from portal_sessions where token_hash = $1',
      [token],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('CA6 — pessoa em duas empresas', () => {
  it('escolhe a empresa e nunca vê documentos da outra (6)', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    const start = await state(seed.alfa.id, token);
    expect(start.companies.map((c) => c.companyId).sort()).toEqual(
      [seed.companies.padaria.id, seed.companies.loja.id].sort(),
    );
    expect(start.activeCompany).toBeNull();
    expect(await listPortalDocuments(start)).toEqual([]);

    expect(await switchPortalCompany(start, seed.companies.padaria.id)).toBe(true);
    const padaria = await state(seed.alfa.id, token);
    const padariaDocs = (await listPortalDocuments(padaria)).map((d) => d.id);
    expect(padariaDocs).toContain(docs.padaria);
    expect(padariaDocs).not.toContain(docs.loja);
    expect(padariaDocs).not.toContain(docs.padariaOculto);
    await expect(getPortalDocumentDownloadUrl(padaria, storage, docs.padaria)).resolves.toContain(
      'X-Amz',
    );
    await expect(getPortalDocumentDownloadUrl(padaria, storage, docs.loja)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getPortalDocumentDownloadUrl(padaria, storage, docs.padariaOculto),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await switchPortalCompany(padaria, seed.companies.loja.id)).toBe(true);
    const loja = await state(seed.alfa.id, token);
    const lojaDocs = (await listPortalDocuments(loja)).map((d) => d.id);
    expect(lojaDocs).toContain(docs.loja);
    expect(lojaDocs).not.toContain(docs.padaria);
    await expect(getPortalDocumentDownloadUrl(loja, storage, docs.padaria)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('não ativa empresa sem acesso, nem de outro escritório (7)', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    const s = await state(seed.alfa.id, token);
    expect(await switchPortalCompany(s, seed.companies.betaPadaria.id)).toBe(false);
    expect((await securityEventsFor(owner, s.ctx.requestId))[0]).toMatchObject({
      type: 'forbidden',
      resource_id: seed.companies.betaPadaria.id,
    });
    await expect(getPortalDocumentDownloadUrl(s, storage, docs.beta)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('acesso revogado tira a empresa da sessão (7)', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    await switchPortalCompany(await state(seed.alfa.id, token), seed.companies.loja.id);
    const dono = memberCtx(seed.alfa.id, seed.users.donoAlfa.id, 'dono');
    await setPortalAccess(dono, seed.companies.loja.id, seed.contacts.joao.id, false);
    try {
      const after = await state(seed.alfa.id, token);
      expect(after.companies.map((c) => c.companyId)).toEqual([seed.companies.padaria.id]);
      // Sobrou só uma empresa: ela vira a ativa sozinha.
      expect(after.activeCompany?.companyId).toBe(seed.companies.padaria.id);
      await expect(getPortalDocumentDownloadUrl(after, storage, docs.loja)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    } finally {
      await setPortalAccess(dono, seed.companies.loja.id, seed.contacts.joao.id, true);
    }
  });
});

describe('sessão presa ao escritório (8)', () => {
  it('sessão do Alfa no endereço do Beta não existe', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    expect(await readPortalSession(seed.beta.id, token, meta())).toBeNull();
    // E a do Beta só enxerga a empresa do Beta.
    const betaToken = await login(seed.beta.id, seed.contacts.joaoBeta.id);
    const beta = await state(seed.beta.id, betaToken);
    expect(beta.companies.map((c) => c.companyId)).toEqual([seed.companies.betaPadaria.id]);
    expect(await readPortalSession(seed.alfa.id, betaToken, meta())).toBeNull();
  });

  it('sair revoga a sessão', async () => {
    const token = await login(seed.alfa.id, seed.contacts.joao.id);
    await signOutPortal(await state(seed.alfa.id, token));
    expect(await readPortalSession(seed.alfa.id, token, meta())).toBeNull();
  });
});
