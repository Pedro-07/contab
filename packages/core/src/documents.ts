/**
 * Documentos por empresa (incremento 2, seção 4). O arquivo vai do navegador direto
 * para o storage por URL assinada; o worker confere o arquivo antes de liberar.
 * Fluxo: requestDocumentUpload → PUT do navegador → confirmDocumentUpload → job
 * document.verify → `disponivel` ou `rejeitado`.
 */
import { tenantKey, type FileStorage, type SignedUpload } from '@contab/adapters/storage';
import { logger } from '@contab/config/logger';
import {
  getCompany,
  getDocument,
  getDocumentVersion,
  insertDocument,
  insertDocumentVersion,
  listCompanyDocuments,
  nextVersionNumber,
  NotFoundError,
  recordAudit,
  setVersionStatus,
  softDeleteDocument,
  updateDocument,
  withTenant,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  canManageDocuments,
  checkDeclaredFile,
  detectFileType,
  DOCUMENT_CATEGORIES,
  DOCUMENT_FILE_TYPES,
  FILE_SIGNATURE_BYTES,
  MAX_DOCUMENT_BYTES,
  safeFileName,
  type UserId,
} from '@contab/domain';
import type { PgBoss } from 'pg-boss';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ClientInputError, uuidOrNotFound } from './clients';
import { actorRole, actorUserId, deny, logNotFound } from './guard';

const FILE_ERRORS = {
  tipo_nao_permitido: 'Envie um arquivo PDF, JPG ou PNG.',
  muito_grande: 'O arquivo passa de 10 MB.',
  vazio: 'O arquivo está vazio.',
} as const;

async function requireDocumentManager(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageDocuments(role))
    await deny(ctx, 'Seu papel não permite alterar documentos.', 'document');
}

const uploadSchema = z.object({
  companyId: z.string(),
  // Vazio: documento novo. Preenchido: nova versão do documento.
  documentId: z.string().optional(),
  category: z.enum(DOCUMENT_CATEGORIES, { message: 'Escolha a pasta.' }).optional(),
  title: z.string().trim().max(200).optional(),
  fileName: z.string().min(1).max(500),
  contentType: z.string().max(200),
  size: z.number().int(),
  visibleToClient: z.boolean().optional().default(true),
});

export type UploadRequest = z.input<typeof uploadSchema>;

export async function requestDocumentUpload(
  ctx: TenantContext,
  storage: FileStorage,
  input: UploadRequest,
): Promise<{ versionId: string; upload: SignedUpload }> {
  await requireDocumentManager(ctx);
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) throw new ClientInputError('Dados do envio inválidos.');
  const data = parsed.data;
  const check = checkDeclaredFile({ contentType: data.contentType, size: data.size });
  if (!check.ok) throw new ClientInputError(FILE_ERRORS[check.reason]);
  const contentType = DOCUMENT_FILE_TYPES[check.type].contentType;
  const fileName = safeFileName(data.fileName);

  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(data.companyId, 'client_company'));
      const uploader = actorUserId(ctx) as UserId | null;
      let documentId: string;
      if (data.documentId) {
        const doc = await getDocument(tx, uuidOrNotFound(data.documentId, 'document'));
        if (doc.companyId !== company.id) throw new NotFoundError('document', data.documentId);
        documentId = doc.id;
      } else {
        if (!data.category) throw new ClientInputError('Escolha a pasta.');
        const title = data.title || fileName.replace(/\.[^.]+$/, '') || 'Documento';
        const doc = await insertDocument(tx, ctx.tenantId, {
          companyId: company.id,
          category: data.category,
          title,
          visibleToClient: data.visibleToClient,
          createdByUserId: uploader,
        });
        documentId = doc.id;
      }

      const version = await nextVersionNumber(tx, documentId);
      const versionId = uuidv7();
      const storageKey = tenantKey(
        ctx.tenantId,
        'companies',
        company.id,
        'documents',
        documentId,
        versionId,
      );
      await insertDocumentVersion(tx, ctx.tenantId, {
        id: versionId,
        documentId,
        version,
        storageKey,
        originalName: fileName,
        contentType,
        sizeBytes: data.size,
        uploadedByUserId: uploader,
      });
      const upload = await storage.presignUpload(ctx.tenantId, storageKey, {
        contentType,
        size: data.size,
        fileName,
      });
      await recordAudit(tx, ctx, {
        action: 'documento.envio_iniciado',
        resourceType: 'document',
        resourceId: documentId,
        metadata: { versao: version, tipo: check.type, bytes: data.size },
      });
      return { versionId, upload };
    }),
  );
}

/** O navegador terminou o PUT: a versão vai para a verificação do worker. */
export async function confirmDocumentUpload(
  ctx: TenantContext,
  boss: PgBoss,
  versionId: string,
): Promise<void> {
  await requireDocumentManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const version = await getDocumentVersion(tx, uuidOrNotFound(versionId, 'document_version'));
      const changed = await setVersionStatus(tx, version.id, ['aguardando_envio'], 'verificando');
      if (changed) await enqueue(boss, ctx, tx, 'document.verify', { versionId: version.id });
    }),
  );
}

export type VerifyResult = 'disponivel' | 'rejeitado' | 'ignorado';

/**
 * Handler do job document.verify, já dentro da transação do tenant do payload.
 * Idempotente: só age sobre versão em `verificando`. Versão de outro tenant não é
 * encontrada (RLS) e o objeto não é tocado.
 */
export async function verifyDocumentVersion(
  tx: TenantTx,
  ctx: TenantContext,
  storage: FileStorage,
  versionId: string,
): Promise<VerifyResult> {
  let version;
  try {
    version = await getDocumentVersion(tx, versionId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      logger.warn({ version_id: versionId }, 'versão não encontrada no tenant do job');
      return 'ignorado';
    }
    throw error;
  }
  if (version.status !== 'verificando') return 'ignorado';

  const reject = async (reason: string, removeObject: boolean): Promise<VerifyResult> => {
    if (removeObject) await storage.delete(ctx.tenantId, version.storageKey);
    await setVersionStatus(tx, version.id, ['verificando'], 'rejeitado', {
      rejectionReason: reason,
    });
    await recordAudit(tx, ctx, {
      action: 'documento.rejeitado',
      resourceType: 'document',
      resourceId: version.documentId,
      metadata: { versao: version.version, motivo: reason },
    });
    return 'rejeitado';
  };

  const size = await storage.size(ctx.tenantId, version.storageKey);
  if (size === null) return reject('arquivo_nao_enviado', false);
  if (size !== version.sizeBytes || size > MAX_DOCUMENT_BYTES) return reject('tamanho', true);

  const type = detectFileType(
    await storage.readStart(ctx.tenantId, version.storageKey, FILE_SIGNATURE_BYTES),
  );
  if (!type || DOCUMENT_FILE_TYPES[type].contentType !== version.contentType) {
    return reject('tipo_diferente', true);
  }

  const sha256 = await storage.sha256(ctx.tenantId, version.storageKey);
  await setVersionStatus(tx, version.id, ['verificando'], 'disponivel', { sha256 });
  await recordAudit(tx, ctx, {
    action: 'documento.disponivel',
    resourceType: 'document',
    resourceId: version.documentId,
    metadata: { versao: version.version },
  });
  return 'disponivel';
}

/** URL de download (5 min) para a equipe. Todos os papéis baixam (D3). */
export async function getDocumentDownloadUrl(
  ctx: TenantContext,
  storage: FileStorage,
  documentId: string,
  versionId?: string,
): Promise<string> {
  if (!actorRole(ctx)) await deny(ctx, 'Sem acesso.', 'document');
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const doc = await getDocument(tx, uuidOrNotFound(documentId, 'document'));
      const docs = await listCompanyDocuments(tx, doc.companyId);
      const full = docs.find((d) => d.id === doc.id);
      const version = versionId
        ? full?.versions.find((v) => v.id === versionId && v.status === 'disponivel')
        : full?.current;
      if (!version) throw new NotFoundError('document_version', versionId ?? doc.id);
      return storage.presignDownload(ctx.tenantId, version.storageKey, {
        fileName: version.originalName,
        contentType: version.contentType,
      });
    }),
  );
}

export async function setDocumentVisibility(
  ctx: TenantContext,
  documentId: string,
  visibleToClient: boolean,
): Promise<void> {
  await requireDocumentManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const doc = await getDocument(tx, uuidOrNotFound(documentId, 'document'));
      await updateDocument(tx, doc.id, { visibleToClient });
      await recordAudit(tx, ctx, {
        action: 'documento.visibilidade_alterada',
        resourceType: 'document',
        resourceId: doc.id,
        metadata: { visivel_ao_cliente: visibleToClient },
      });
    }),
  );
}

/** Exclusão lógica. Os arquivos ficam no storage até a rotina de retenção (LGPD). */
export async function deleteDocument(ctx: TenantContext, documentId: string): Promise<void> {
  await requireDocumentManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const doc = await getDocument(tx, uuidOrNotFound(documentId, 'document'));
      await softDeleteDocument(tx, doc.id);
      await recordAudit(tx, ctx, {
        action: 'documento.excluido',
        resourceType: 'document',
        resourceId: doc.id,
      });
    }),
  );
}
