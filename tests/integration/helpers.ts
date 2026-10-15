import { createFileStorage, type FileStorage } from '@contab/adapters/storage';
import { confirmDocumentUpload, requestDocumentUpload } from '@contab/core';
import type { TenantContext } from '@contab/db';
import { createJobs } from '@contab/worker/jobs';
import type { PgBoss } from 'pg-boss';
import { createDb, type Db } from '@contab/db/testing';
import type { Role, TenantId, UserId } from '@contab/domain';
import { randomUUID } from 'node:crypto';

/** Storage de teste (SeaweedFS do docker compose, bucket de teste do .env.test). */
export function testStorage(): FileStorage {
  return createFileStorage({
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT!,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET!,
    STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID!,
    STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY!,
  });
}

/** Conexão com o papel `app` (sem BYPASSRLS), a mesma da aplicação. */
export function appDb(max = 4): Db {
  return createDb(process.env.DATABASE_URL!, { max });
}

/** Conexão com o papel owner, só para inspecionar efeitos colaterais nos testes. */
export function ownerDb(): Db {
  return createDb(process.env.DATABASE_MIGRATOR_URL!, { max: 2 });
}

export function memberCtx(tenantId: TenantId, userId: UserId, role: Role): TenantContext {
  return {
    tenantId,
    actor: { type: 'member', userId, role },
    requestId: `teste-${randomUUID()}`,
    ip: '127.0.0.1',
  };
}

export function systemCtx(tenantId: TenantId): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'teste', jobId: randomUUID() },
    requestId: `teste-${randomUUID()}`,
  };
}

/** Eventos de segurança gravados para uma requisição (lidos com o papel owner). */
export async function securityEventsFor(owner: Db, requestId: string) {
  const { rows } = await owner.$client.query<{
    type: string;
    resource_type: string | null;
    resource_id: string | null;
  }>('select type, resource_type, resource_id from security_events where request_id = $1', [
    requestId,
  ]);
  return rows;
}

/**
 * Mensagem do erro original do Postgres. O Drizzle embrulha o erro em "Failed query"
 * e guarda o do driver em `cause`; o teste precisa provar o motivo (RLS, FK), não só a falha.
 */
export async function dbErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (err as Error).message;
  }
  throw new Error('esperava que a operação falhasse');
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@exemplo.test`;
}

export const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.7\n% documento fictício de teste\n%%EOF\n',
);
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** Roda o job document.verify como o worker faria. */
export async function runVerifyJob(tenantId: string, versionId: string) {
  const { createCipher } = await import('@contab/adapters/crypto');
  const { createFakeProvider } = await import('@contab/adapters/whatsapp');
  const job = createJobs({
    email: { send: async () => undefined },
    painelUrl: 'http://app.localhost:3000',
    storage: testStorage(),
    boss: undefined as never,
    whatsapp: createFakeProvider(),
    cipher: createCipher({
      CRYPTO_PROVIDER: 'local',
      CRYPTO_LOCAL_KEY: process.env.CRYPTO_LOCAL_KEY!,
    }),
    portalOrigin: (slug) => `http://${slug}.localhost:3000`,
    linkSecret: process.env.BETTER_AUTH_SECRET!,
  }).find((j) => j.name === 'document.verify')!;
  await job.run({ id: randomUUID(), data: { tenantId, versionId } });
}

/**
 * Sobe um documento pelo fluxo completo: pede o envio, faz o PUT na URL assinada,
 * confirma e roda a verificação.
 */
export async function uploadTestDocument(
  ctx: TenantContext,
  boss: PgBoss,
  input: {
    companyId: string;
    documentId?: string;
    title?: string;
    bytes?: Uint8Array;
    contentType?: string;
    visibleToClient?: boolean;
  },
): Promise<{ versionId: string; documentId: string }> {
  const bytes = input.bytes ?? PDF_BYTES;
  const contentType = input.contentType ?? 'application/pdf';
  const { versionId, upload } = await requestDocumentUpload(ctx, testStorage(), {
    companyId: input.companyId,
    ...(input.documentId ? { documentId: input.documentId } : { category: 'outros' }),
    title: input.title ?? `Documento ${randomUUID().slice(0, 6)}`,
    fileName: 'documento.pdf',
    contentType,
    size: bytes.length,
    visibleToClient: input.visibleToClient ?? true,
  });
  const put = await fetch(upload.url, { method: 'PUT', body: bytes, headers: upload.headers });
  if (!put.ok) throw new Error(`PUT falhou: ${put.status}`);
  await confirmDocumentUpload(ctx, boss, versionId);
  await runVerifyJob(ctx.tenantId, versionId);
  const { rows } = await ownerDbOnce().$client.query<{ document_id: string }>(
    'select document_id from document_versions where id = $1',
    [versionId],
  );
  return { versionId, documentId: rows[0]!.document_id };
}

let sharedOwner: Db | undefined;
/** Conexão owner compartilhada pelos helpers (fechada pelo processo de teste). */
function ownerDbOnce(): Db {
  sharedOwner ??= ownerDb();
  return sharedOwner;
}
