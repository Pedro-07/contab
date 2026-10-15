/**
 * Documentos (incremento 2, testes 3, 4, 5 e 9 da seção 8), com Postgres e storage reais.
 */
import {
  ClientInputError,
  deleteDocument,
  getCompanyProfile,
  getDocumentDownloadUrl,
  requestDocumentUpload,
  setDocumentVisibility,
} from '@contab/core';
import { ForbiddenError, NotFoundError } from '@contab/db';
import { createBoss } from '@contab/db/queue';
import type { Db } from '@contab/db/testing';
import { MAX_DOCUMENT_BYTES } from '@contab/domain';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  memberCtx,
  ownerDb,
  PDF_BYTES,
  PNG_BYTES,
  runVerifyJob,
  securityEventsFor,
  testStorage,
  uploadTestDocument,
} from './helpers';

const seed = inject('seed');
const storage = testStorage();
let owner: Db;
let boss: PgBoss;

const contador = () => memberCtx(seed.alfa.id, seed.users.contadorAlfa.id, 'contador');
const atendente = () => memberCtx(seed.alfa.id, seed.users.atendenteAlfa.id, 'atendente');
const donoBeta = () => memberCtx(seed.beta.id, seed.users.donoBeta.id, 'dono');

let betaDoc: { versionId: string; documentId: string };

beforeAll(async () => {
  owner = ownerDb();
  boss = createBoss(process.env.DATABASE_URL!);
  await boss.start();
  betaDoc = await uploadTestDocument(donoBeta(), boss, {
    companyId: seed.companies.betaPadaria.id,
    title: 'Contrato do Beta',
  });
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await owner.$client.end();
});

async function version(id: string) {
  const { rows } = await owner.$client.query<{
    status: string;
    sha256: string | null;
    rejection_reason: string | null;
    storage_key: string;
  }>('select status, sha256, rejection_reason, storage_key from document_versions where id = $1', [
    id,
  ]);
  return rows[0]!;
}

describe('envio e verificação', () => {
  it('PDF enviado fica disponível, com hash, e a equipe toda baixa', async () => {
    const { versionId, documentId } = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.padaria.id,
      title: 'Contrato social',
    });
    const v = await version(versionId);
    expect(v.status).toBe('disponivel');
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.storage_key.startsWith(`tenants/${seed.alfa.id}/companies/`)).toBe(true);

    const url = await getDocumentDownloadUrl(atendente(), storage, documentId);
    const file = await fetch(url);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('arquivo declarado como PDF mas com conteúdo PNG é rejeitado e apagado', async () => {
    const { versionId } = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.padaria.id,
      bytes: PNG_BYTES,
      contentType: 'application/pdf',
    });
    const v = await version(versionId);
    expect(v).toMatchObject({ status: 'rejeitado', rejection_reason: 'tipo_diferente' });
    expect(await storage.size(seed.alfa.id, v.storage_key)).toBeNull();
  });

  it('confirmação sem envio vira rejeitado (arquivo não enviado)', async () => {
    const ctx = contador();
    const { versionId } = await requestDocumentUpload(ctx, storage, {
      companyId: seed.companies.padaria.id,
      category: 'certidoes',
      fileName: 'certidao.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    const { confirmDocumentUpload } = await import('@contab/core');
    await confirmDocumentUpload(ctx, boss, versionId);
    await confirmDocumentUpload(ctx, boss, versionId); // idempotente
    await runVerifyJob(seed.alfa.id, versionId);
    expect(await version(versionId)).toMatchObject({
      status: 'rejeitado',
      rejection_reason: 'arquivo_nao_enviado',
    });
  });

  it('tipo não permitido e arquivo grande são recusados antes do envio', async () => {
    const base = {
      companyId: seed.companies.padaria.id,
      category: 'outros' as const,
      fileName: 'x',
    };
    await expect(
      requestDocumentUpload(contador(), storage, {
        ...base,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 10,
      }),
    ).rejects.toThrow('Envie um arquivo PDF, JPG ou PNG.');
    await expect(
      requestDocumentUpload(contador(), storage, {
        ...base,
        contentType: 'image/png',
        size: MAX_DOCUMENT_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(ClientInputError);
  });

  it('versão nova preserva a anterior; a atual é a mais nova disponível', async () => {
    const first = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.loja.id,
      title: 'Alvará',
    });
    const second = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.loja.id,
      documentId: first.documentId,
      bytes: PNG_BYTES,
      contentType: 'image/png',
    });
    expect(second.documentId).toBe(first.documentId);
    const profile = await getCompanyProfile(contador(), seed.companies.loja.id);
    const doc = profile.documents.find((d) => d.id === first.documentId)!;
    expect(doc.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(doc.current?.id).toBe(second.versionId);
    expect(doc.current?.contentType).toBe('image/png');
  });
});

describe('isolamento (3, 4, 5)', () => {
  it('URL de documento do Beta nunca é gerada para o Alfa (3)', async () => {
    const ctx = contador();
    await expect(getDocumentDownloadUrl(ctx, storage, betaDoc.documentId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await securityEventsFor(owner, ctx.requestId)).toEqual([
      { type: 'resource_not_found', resource_type: 'document', resource_id: betaDoc.documentId },
    ]);
  });

  it('Alfa não sobe arquivo em empresa nem em documento do Beta', async () => {
    await expect(
      requestDocumentUpload(contador(), storage, {
        companyId: seed.companies.betaPadaria.id,
        category: 'outros',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        size: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      requestDocumentUpload(contador(), storage, {
        companyId: seed.companies.padaria.id,
        documentId: betaDoc.documentId,
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        size: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Alfa não apaga nem esconde documento do Beta', async () => {
    await expect(deleteDocument(contador(), betaDoc.documentId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      setDocumentVisibility(contador(), betaDoc.documentId, false),
    ).rejects.toBeInstanceOf(NotFoundError);
    const { rows } = await owner.$client.query(
      'select deleted_at, visible_to_client from documents where id = $1',
      [betaDoc.documentId],
    );
    expect(rows[0]).toEqual({ deleted_at: null, visible_to_client: true });
    const v = await version(betaDoc.versionId);
    expect(await storage.size(seed.beta.id, v.storage_key)).toBe(PDF_BYTES.length);
  });

  it('job do Alfa com versão do Beta não acha a versão nem toca no arquivo (5)', async () => {
    const ctx = donoBeta();
    const { versionId, upload } = await requestDocumentUpload(ctx, storage, {
      companyId: seed.companies.betaPadaria.id,
      category: 'outros',
      fileName: 'b.pdf',
      contentType: 'application/pdf',
      size: PDF_BYTES.length,
    });
    await fetch(upload.url, { method: 'PUT', body: PDF_BYTES, headers: upload.headers });
    await owner.$client.query(`update document_versions set status = 'verificando' where id = $1`, [
      versionId,
    ]);

    await runVerifyJob(seed.alfa.id, versionId);

    const v = await version(versionId);
    expect(v.status).toBe('verificando');
    expect(await storage.size(seed.beta.id, v.storage_key)).toBe(PDF_BYTES.length);
  });
});

describe('permissões (9)', () => {
  it('atendente baixa, mas não sobe, não apaga e não muda visibilidade', async () => {
    const { documentId } = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.padaria.id,
    });
    const ctx = atendente();
    await expect(getDocumentDownloadUrl(ctx, storage, documentId)).resolves.toContain('X-Amz');
    await expect(
      requestDocumentUpload(ctx, storage, {
        companyId: seed.companies.padaria.id,
        category: 'outros',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        size: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteDocument(ctx, documentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setDocumentVisibility(ctx, documentId, false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('documento excluído some da ficha e não baixa mais', async () => {
    const { documentId } = await uploadTestDocument(contador(), boss, {
      companyId: seed.companies.padaria.id,
    });
    await deleteDocument(contador(), documentId);
    const profile = await getCompanyProfile(contador(), seed.companies.padaria.id);
    expect(profile.documents.map((d) => d.id)).not.toContain(documentId);
    await expect(getDocumentDownloadUrl(contador(), storage, documentId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
