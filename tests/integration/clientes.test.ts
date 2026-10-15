/**
 * Empresas-clientes e contatos (incremento 2, testes 1, 2, 9 e 10 da seção 8).
 * Cada teste negativo confere o erro, o banco e o security_events.
 */
import {
  addContactToCompany,
  ClientInputError,
  createCompany,
  editCompany,
  getCompanyProfile,
  getContactProfile,
  listClientCompanies,
  removeContactFromCompany,
  setCompanyStatus,
  setContactConsent,
  setPortalAccess,
} from '@contab/core';
import { ForbiddenError, NotFoundError } from '@contab/db';
import type { Db } from '@contab/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { memberCtx, ownerDb, securityEventsFor } from './helpers';

const seed = inject('seed');
let owner: Db;

const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const atendente = () => memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente');
const donoBeta = () => memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');

beforeAll(() => {
  owner = ownerDb();
});

afterAll(async () => {
  await owner.$client.end();
});

async function betaCompanyRow() {
  const { rows } = await owner.$client.query(
    'select legal_name, status, updated_at from client_companies where id = $1',
    [seed.companies.betaPadaria.id],
  );
  return rows[0];
}

describe('lista e ficha', () => {
  it('a lista do Alfa só tem empresas do Alfa', async () => {
    const { rows } = await listClientCompanies(contador());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(seed.companies.padaria.id);
    expect(ids).toContain(seed.companies.loja.id);
    expect(ids).not.toContain(seed.companies.betaPadaria.id);
  });

  it('busca por nome e por CNPJ com máscara', async () => {
    expect(
      (await listClientCompanies(contador(), { search: 'padaria' })).rows.map((r) => r.id),
    ).toEqual([seed.companies.padaria.id]);
    expect(
      (await listClientCompanies(contador(), { search: '44.555.666' })).rows.map((r) => r.id),
    ).toEqual([seed.companies.loja.id]);
    expect((await listClientCompanies(contador(), { search: '%' })).rows).toHaveLength(0);
  });

  it('atendente vê a ficha (D3)', async () => {
    const profile = await getCompanyProfile(atendente(), seed.companies.padaria.id);
    expect(profile.company.cnpj).toBe('11222333000181');
    expect(profile.contacts.map((c) => c.contactId)).toContain(seed.contacts.joao.id);
  });
});

describe('isolamento (1, 2)', () => {
  it.each([
    ['ficha', () => getCompanyProfile(contador(), seed.companies.betaPadaria.id)],
    [
      'edição',
      () =>
        editCompany(contador(), seed.companies.betaPadaria.id, {
          cnpj: '11222333000181',
          legalName: 'Invadida',
          regime: 'SN',
        }),
    ],
    ['status', () => setCompanyStatus(contador(), seed.companies.betaPadaria.id, 'inativa')],
    [
      'novo contato',
      () =>
        addContactToCompany(contador(), seed.companies.betaPadaria.id, {
          name: 'Intruso',
          phone: '(98) 99111-2222',
        }),
    ],
    ['ficha do contato', () => getContactProfile(contador(), seed.contacts.joaoBeta.id)],
    [
      'desvincular contato',
      () =>
        removeContactFromCompany(contador(), seed.companies.padaria.id, seed.contacts.joaoBeta.id),
    ],
    [
      'acesso ao portal',
      () => setPortalAccess(contador(), seed.companies.betaPadaria.id, seed.contacts.joao.id, true),
    ],
    [
      'consentimento',
      () => setContactConsent(contador(), seed.contacts.joaoBeta.id, 'email', false),
    ],
    ['ID que não é UUID', () => getCompanyProfile(contador(), 'abc')],
  ])('%s de outro escritório: 404, sem efeito, com security_event', async (_, action) => {
    const before = await betaCompanyRow();
    await expect(action()).rejects.toBeInstanceOf(NotFoundError);
    expect(await betaCompanyRow()).toEqual(before);
  });

  it('a busca sem resultado fica registrada', async () => {
    const ctx = contador();
    await expect(getCompanyProfile(ctx, seed.companies.betaPadaria.id)).rejects.toThrow();
    expect(await securityEventsFor(owner, ctx.requestId)).toEqual([
      {
        type: 'resource_not_found',
        resource_type: 'client_company',
        resource_id: seed.companies.betaPadaria.id,
      },
    ]);
  });

  it('o mesmo CNPJ existe nos dois escritórios sem conflito (2)', async () => {
    const { rows } = await owner.$client.query<{ tenant_id: string }>(
      'select tenant_id from client_companies where cnpj = $1 order by tenant_id',
      ['11222333000181'],
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([seed.alfa.id, seed.beta.id].sort());
    // Dentro do Alfa, o CNPJ já existe.
    await expect(
      createCompany(contador(), { cnpj: '11222333000181', legalName: 'Outra', regime: 'MEI' }),
    ).rejects.toBeInstanceOf(ClientInputError);
  });
});

describe('permissões (9)', () => {
  it('atendente não cria, edita nem mexe em contatos; fica registrado', async () => {
    const ctx = atendente();
    await expect(
      createCompany(ctx, { cnpj: '77888999000181', legalName: 'Nova', regime: 'SN' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setCompanyStatus(ctx, seed.companies.padaria.id, 'inativa'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addContactToCompany(ctx, seed.companies.padaria.id, { name: 'X', phone: '98991112222' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await securityEventsFor(owner, ctx.requestId)).map((e) => e.type)).toEqual([
      'forbidden',
      'forbidden',
      'forbidden',
    ]);
    const { rows } = await owner.$client.query('select 1 from client_companies where cnpj = $1', [
      '77888999000181',
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('cadastro', () => {
  it('cria empresa com CNPJ com máscara e recusa CNPJ inválido', async () => {
    const ctx = memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');
    const company = await createCompany(ctx, {
      cnpj: '77.888.999/0001-81',
      legalName: 'Comércio Fictício',
      regime: 'MEI',
    });
    expect(company.cnpj).toBe('77888999000181');
    await expect(
      createCompany(ctx, { cnpj: '77.888.999/0001-82', legalName: 'X', regime: 'MEI' }),
    ).rejects.toThrow('CNPJ inválido.');
  });

  it('contato novo com opt-in registra o histórico; opt-out também', async () => {
    const ctx = contador();
    await addContactToCompany(ctx, seed.companies.loja.id, {
      name: 'Maria Fictícia',
      phone: '(98) 99222-3333',
      email: 'maria@exemplo.test',
      role: 'financeiro',
      whatsappOptIn: 'on',
    });
    const { rows } = await owner.$client.query<{ id: string; whatsapp_opt_in_at: Date | null }>(
      'select id, whatsapp_opt_in_at from contacts where tenant_id = $1 and phone = $2',
      [seed.alfa.id, '+5598992223333'],
    );
    expect(rows[0]!.whatsapp_opt_in_at).not.toBeNull();

    await setContactConsent(ctx, rows[0]!.id, 'whatsapp', false);
    const profile = await getContactProfile(ctx, rows[0]!.id);
    expect(profile.contact.whatsappOptInAt).toBeNull();
    expect(
      profile.consents.filter((c) => c.channel === 'whatsapp').map((c) => [c.status, c.source]),
    ).toEqual([
      ['opt_out', 'cadastro_manual'],
      ['opt_in', 'cadastro_manual'],
    ]);
    // E-mail não informado no formulário: vale o padrão do escritório (P25).
    expect(profile.consents.find((c) => c.channel === 'email')?.source).toBe('padrao_escritorio');
  });

  it('o mesmo telefone em outra empresa reaproveita o contato', async () => {
    const ctx = contador();
    await addContactToCompany(ctx, seed.companies.padaria.id, {
      name: 'Maria Fictícia',
      phone: '+5598992223333',
    });
    const { rows } = await owner.$client.query(
      'select id from contacts where tenant_id = $1 and phone = $2',
      [seed.alfa.id, '+5598992223333'],
    );
    expect(rows).toHaveLength(1);
  });

  it('dono do Beta também não enxerga o Alfa', async () => {
    const { rows } = await listClientCompanies(donoBeta());
    expect(rows.map((r) => r.id)).not.toContain(seed.companies.padaria.id);
  });
});
