/**
 * Importação por CSV (incremento 2, seção 5): leitura, prévia, aplicação, opt-in (D2)
 * e isolamento (importar no Alfa nunca altera o Beta).
 */
import {
  applyCsvImport,
  ClientInputError,
  createCompany,
  CSV_TEMPLATE,
  previewCsvImport,
  readCsv,
} from '@contab/core';
import { ForbiddenError } from '@contab/db';
import type { Db } from '@contab/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { memberCtx, ownerDb } from './helpers';

const seed = inject('seed');
let owner: Db;

const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const enc = (text: string) => new TextEncoder().encode(text);

/** Windows-1252, como o Excel em português salva. */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
}

const HEADER =
  'cnpj;razao_social;nome_fantasia;regime;inscricao_estadual;contato_nome;contato_telefone;contato_email;contato_papel;canal_preferido;aceita_whatsapp;aceita_email;recebe_envios;acesso_portal';

beforeAll(() => {
  owner = ownerDb();
});

afterAll(async () => {
  await owner.$client.end();
});

describe('leitura do arquivo', () => {
  it('o modelo para baixar é válido', () => {
    const { rows, errors } = readCsv(enc(CSV_TEMPLATE));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contact?.phone).toBe('+5598912345678');
  });

  it('aceita vírgula, aspas, BOM e cabeçalho com acento e maiúsculas', () => {
    const csv =
      '﻿CNPJ,Razão Social,Regime,Contato Nome,Contato Telefone\r\n' +
      '"11.222.333/0001-81","Padaria ""Boa"", Ltda",sn,João,98990000009\r\n';
    const { rows, errors } = readCsv(enc(csv));
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      cnpj: '11222333000181',
      legalName: 'Padaria "Boa", Ltda',
      regime: 'SN',
      // Coluna ausente: "não informado", vale o padrão (P25).
      contact: { name: 'João', phone: '+5598990000009', whatsappOptIn: undefined },
    });
  });

  it('lê arquivo do Excel em Windows-1252', () => {
    const { rows } = readCsv(
      cp1252('cnpj;razao_social;regime\n11222333000181;Padaria São João;SN\n'),
    );
    expect(rows[0]!.legalName).toBe('Padaria São João');
  });

  it('aponta o erro de cada linha e segue com as válidas', () => {
    const csv = [
      HEADER,
      '11222333000181;Padaria;;SN;;Ana;98991110000;;socio;;sim;;;',
      '11222333000182;CNPJ errado;;SN;;;;;;;;;;',
      '44555666000181;Loja;;XX;;;;;;;;;;',
      '44555666000181;Loja;;SN;;Bia;123;;;;;;;',
      '44555666000181;Loja;;SN;;Caio;;;;;sim;;;',
      '44555666000181;Loja;;SN;;Duda;98991110001;;;;talvez;;;',
      '11222333000181;Outra razão;;SN;;;;;;;;;;',
    ].join('\n');
    const { rows, errors } = readCsv(enc(csv));
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      { line: 3, message: 'CNPJ inválido.' },
      { line: 4, message: 'Regime deve ser SN, MEI, LP ou LR.' },
      { line: 5, message: 'Telefone do contato inválido.' },
      { line: 6, message: 'Contato sem telefone e sem e-mail.' },
      { line: 7, message: 'Use "sim" ou "não" nas colunas de autorização.' },
      { line: 8, message: 'Dados da empresa diferentes da linha 2 (mesmo CNPJ).' },
    ]);
  });

  it('recusa arquivo vazio, sem colunas obrigatórias ou grande demais', () => {
    expect(() => readCsv(enc(''))).toThrow(ClientInputError);
    expect(() => readCsv(enc('nome;telefone\nA;1\n'))).toThrow(/cnpj, razao_social, regime/);
    expect(() => readCsv(new Uint8Array(1024 * 1024 + 1).fill(65))).toThrow(/1 MB/);
  });
});

describe('importação', () => {
  const csv = (cnpj: string, phone: string) =>
    enc(
      [
        HEADER,
        `${cnpj};Importada Fictícia Ltda;Importada;MEI;;Rita Fictícia;${phone};rita@exemplo.test;socio;ambos;sim;sim;sim;sim`,
        `${cnpj};Importada Fictícia Ltda;Importada;MEI;;Sol Fictício;;sol@exemplo.test;financeiro;email;;sim;nao;`,
        `00000000000000;Linha ruim;;SN;;;;;;;;;;`,
      ].join('\n'),
    );

  it('prévia conta empresas, contatos e erros sem gravar nada', async () => {
    const preview = await previewCsvImport(contador(), csv('59545785000120', '98993330001'));
    expect(preview).toMatchObject({
      companiesNew: 1,
      companiesUpdated: 0,
      contacts: 2,
      validLines: 2,
    });
    expect(preview.errors).toHaveLength(1);
    const { rows } = await owner.$client.query('select 1 from client_companies where cnpj = $1', [
      '59545785000120',
    ]);
    expect(rows).toHaveLength(0);
  });

  it('grava as autorizações com a origem certa e não duplica ao importar de novo (P25)', async () => {
    const ctx = contador();
    // Rita: "sim" nos dois canais; Sol: só e-mail, com "sim".
    const first = await applyCsvImport(ctx, csv('59545785000120', '98993330001'));
    expect(first).toMatchObject({ companiesNew: 1, contacts: 2, optIns: 3 });

    const second = await applyCsvImport(ctx, csv('59545785000120', '98993330001'));
    expect(second).toMatchObject({ companiesNew: 0, companiesUpdated: 1, contacts: 2, optIns: 0 });

    const companies = await owner.$client.query(
      'select id from client_companies where tenant_id = $1 and cnpj = $2',
      [seed.alfa.id, '59545785000120'],
    );
    expect(companies.rows).toHaveLength(1);
    const contacts = await owner.$client.query<{ name: string; whatsapp_opt_in_at: Date | null }>(
      `select c.name, c.whatsapp_opt_in_at from contacts c
         join company_contacts cc on cc.tenant_id = c.tenant_id and cc.contact_id = c.id
        where cc.company_id = $1 order by c.name`,
      [companies.rows[0].id],
    );
    expect(contacts.rows.map((r) => r.name)).toEqual(['Rita Fictícia', 'Sol Fictício']);
    expect(contacts.rows[0]!.whatsapp_opt_in_at).not.toBeNull();

    const consents = await owner.$client.query<{ source: string; actor_user_id: string }>(
      'select source, actor_user_id from contact_consents where tenant_id = $1 and source = $2',
      [seed.alfa.id, 'importacao'],
    );
    expect(consents.rows).toHaveLength(3);
    expect(consents.rows[0]!.actor_user_id).toBe(seed.users.contadorAlfa.id);

    // A auditoria guarda só os totais.
    const audit = await owner.$client.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_logs where tenant_id = $1 and action = 'clientes.importados'
        order by created_at desc limit 1`,
      [seed.alfa.id],
    );
    const text = JSON.stringify(audit.rows[0]!.metadata);
    expect(audit.rows[0]!.metadata).toMatchObject({ empresas_atualizadas: 1, opt_ins: 0 });
    for (const leaked of ['Rita', 'rita@', '98993330001', 'Importada']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('em branco vale o padrão do escritório; "não" desmarca; opt-out do cliente não é desfeito', async () => {
    const ctx = contador();
    const file = (whats: string) =>
      enc(
        [
          HEADER,
          `35717283000171;Padrão Fictício Ltda;;SN;;Tom Fictício;98993330003;tom@exemplo.test;outro;ambos;${whats};;sim;`,
        ].join(String.fromCharCode(10)),
      );
    await applyCsvImport(ctx, file(''));
    const tom = async () =>
      (
        await owner.$client.query<{ id: string; w: Date | null; e: Date | null }>(
          'select id, whatsapp_opt_in_at as w, email_opt_in_at as e from contacts where tenant_id = $1 and phone = $2',
          [seed.alfa.id, '+5598993330003'],
        )
      ).rows[0]!;
    const created = await tom();
    expect(created.w).not.toBeNull();
    expect(created.e).not.toBeNull();
    const sources = await owner.$client.query<{ source: string }>(
      'select source from contact_consents where contact_id = $1',
      [created.id],
    );
    expect(sources.rows.map((r) => r.source)).toEqual(['padrao_escritorio', 'padrao_escritorio']);

    // "não" na coluna desmarca.
    await applyCsvImport(ctx, file('não'));
    expect((await tom()).w).toBeNull();

    // O cliente pediu para sair: nem "sim" do escritório reativa.
    await owner.$client.query(
      `insert into contact_consents (tenant_id, id, contact_id, channel, status, source)
       values ($1, gen_random_uuid(), $2, 'whatsapp', 'opt_out', 'cliente')`,
      [seed.alfa.id, created.id],
    );
    await applyCsvImport(ctx, file('sim'));
    expect((await tom()).w).toBeNull();
  });

  it('importar no Alfa um CNPJ que existe no Beta não altera o Beta', async () => {
    const beta = memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');
    await createCompany(beta, { cnpj: '86574328000137', legalName: 'Só do Beta', regime: 'LP' });

    await applyCsvImport(contador(), csv('86574328000137', '98993330002'));

    const { rows } = await owner.$client.query<{ tenant_id: string; legal_name: string }>(
      'select tenant_id, legal_name from client_companies where cnpj = $1',
      ['86574328000137'],
    );
    expect(rows.find((r) => r.tenant_id === seed.beta.id)?.legal_name).toBe('Só do Beta');
    expect(rows.find((r) => r.tenant_id === seed.alfa.id)?.legal_name).toBe(
      'Importada Fictícia Ltda',
    );
  });

  it('atendente não importa (D3)', async () => {
    const ctx = memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente');
    await expect(previewCsvImport(ctx, enc(CSV_TEMPLATE))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyCsvImport(ctx, enc(CSV_TEMPLATE))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('arquivo só com linhas ruins não importa nada', async () => {
    await expect(
      applyCsvImport(contador(), enc(`${HEADER}\n00000000000000;X;;SN;;;;;;;;;;`)),
    ).rejects.toThrow('Nenhuma linha válida para importar.');
  });
});
