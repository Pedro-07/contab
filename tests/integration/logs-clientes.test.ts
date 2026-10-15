/**
 * Item 10 da seção 8 do incremento 2: importação e envio de documentos não levam
 * conteúdo do CSV, nomes, telefones, e-mails nem o conteúdo do arquivo para o log.
 */
import { applyCsvImport } from '@contab/core';
import { logger } from '@contab/config/logger';
import { createBoss } from '@contab/db/queue';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { memberCtx, uploadTestDocument } from './helpers';

const seed = inject('seed');
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  vi.restoreAllMocks();
});

describe('logs sem conteúdo (10)', () => {
  it('nada do CSV nem do arquivo aparece no log', async () => {
    const calls: unknown[] = [];
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        calls.push(args);
      }) as never);
    }

    const ctx = memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
    const csv = [
      'cnpj;razao_social;regime;contato_nome;contato_telefone;contato_email',
      '64.104.355/0001-03;Empresa Secreta Ltda;SN;Pessoa Secreta;(98) 99777-1234;secreta@exemplo.test',
    ].join('\n');
    await applyCsvImport(ctx, new TextEncoder().encode(csv), { consentDeclared: true });
    await uploadTestDocument(ctx, boss, {
      companyId: seed.companies.padaria.id,
      title: 'Título Secreto',
      bytes: new TextEncoder().encode('%PDF-1.7\nCONTEUDO-SECRETO\n'),
    });

    const text = JSON.stringify(calls);
    for (const leaked of [
      'Empresa Secreta',
      'Pessoa Secreta',
      '99777',
      'secreta@',
      'Título Secreto',
      'CONTEUDO-SECRETO',
      'X-Amz-Signature',
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });
});
