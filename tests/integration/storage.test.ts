/**
 * Adaptador de storage contra o SeaweedFS real (incremento 2, seção 4 e testes 3 e 4).
 */
import { SIGNED_URL_TTL_SECONDS, StorageKeyError, tenantKey } from '@contab/adapters/storage';
import { randomUUID } from 'node:crypto';
import { describe, expect, inject, it } from 'vitest';
import { testStorage } from './helpers';

const seed = inject('seed');
const storage = testStorage();
const PDF = new TextEncoder().encode('%PDF-1.7\nconteudo ficticio\n%%EOF');

async function upload(tenantId: string, key: string, body: Uint8Array, contentType: string) {
  const signed = await storage.presignUpload(tenantId, key, {
    contentType,
    size: body.length,
    fileName: 'Contrato social.pdf',
  });
  return fetch(signed.url, {
    method: 'PUT',
    body,
    headers: { ...signed.headers, origin: 'http://app.localhost:3000' },
  });
}

describe('storage', () => {
  it('envia pela URL assinada, lê o início, calcula o hash e apaga', async () => {
    const key = tenantKey(seed.alfa.id, 'testes', randomUUID());
    const put = await upload(seed.alfa.id, key, PDF, 'application/pdf');
    expect(put.status).toBe(200);
    expect(put.headers.get('access-control-allow-origin')).toBe('http://app.localhost:3000');

    expect(await storage.size(seed.alfa.id, key)).toBe(PDF.length);
    expect(new TextDecoder().decode(await storage.readStart(seed.alfa.id, key, 5))).toBe('%PDF-');
    expect(await storage.sha256(seed.alfa.id, key)).toMatch(/^[0-9a-f]{64}$/);

    const download = await storage.presignDownload(seed.alfa.id, key, {
      fileName: 'Contrato social.pdf',
      contentType: 'application/pdf',
    });
    const got = await fetch(download);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PDF);

    await storage.delete(seed.alfa.id, key);
    expect(await storage.size(seed.alfa.id, key)).toBeNull();
  });

  it('URLs assinadas valem 5 minutos', async () => {
    const key = tenantKey(seed.alfa.id, 'testes', randomUUID());
    const url = new URL(
      await storage.presignDownload(seed.alfa.id, key, {
        fileName: 'a.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('o tamanho declarado entra na assinatura: corpo diferente é recusado', async () => {
    const key = tenantKey(seed.alfa.id, 'testes', randomUUID());
    const signed = await storage.presignUpload(seed.alfa.id, key, {
      contentType: 'application/pdf',
      size: 10,
      fileName: 'a.pdf',
    });
    const put = await fetch(signed.url, { method: 'PUT', body: PDF, headers: signed.headers });
    expect(put.ok).toBe(false);
    expect(await storage.size(seed.alfa.id, key)).toBeNull();
  });

  it('URL adulterada (outra chave) não vale', async () => {
    const key = tenantKey(seed.alfa.id, 'testes', randomUUID());
    await upload(seed.alfa.id, key, PDF, 'application/pdf');
    const url = new URL(
      await storage.presignDownload(seed.alfa.id, key, {
        fileName: 'a.pdf',
        contentType: 'application/pdf',
      }),
    );
    url.pathname = url.pathname.replace(seed.alfa.id, seed.beta.id);
    expect((await fetch(url)).status).toBe(403);
    await storage.delete(seed.alfa.id, key);
  });

  it('recusa chave fora do prefixo do tenant, sem chamar o provedor (4)', async () => {
    const betaKey = tenantKey(seed.beta.id, 'testes', randomUUID());
    await expect(storage.size(seed.alfa.id, betaKey)).rejects.toBeInstanceOf(StorageKeyError);
    await expect(storage.delete(seed.alfa.id, betaKey)).rejects.toBeInstanceOf(StorageKeyError);
    await expect(
      storage.presignDownload(seed.alfa.id, betaKey, { fileName: 'a', contentType: 'a/b' }),
    ).rejects.toBeInstanceOf(StorageKeyError);
    await expect(
      storage.size(seed.alfa.id, `tenants/${seed.alfa.id}/../${seed.beta.id}/x`),
    ).rejects.toBeInstanceOf(StorageKeyError);
    expect(() => tenantKey(seed.alfa.id, '..', 'x')).toThrow(StorageKeyError);
    expect(() => tenantKey('nao-uuid', 'x')).toThrow(StorageKeyError);
  });
});
