import type { DocumentCategory, TenantId, UserId } from '@contab/domain';
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { documents, documentVersions } from '../schema';
import type { TenantTx } from '../tenant';

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type VersionStatus = DocumentVersion['status'];

/** Documento com a versão atual (maior versão disponível) e a última enviada. */
export type DocumentWithVersions = DocumentRow & {
  current: DocumentVersion | null;
  latest: DocumentVersion | null;
  versions: DocumentVersion[];
};

const activeDocument = isNull(documents.deletedAt);

export async function listCompanyDocuments(
  tx: TenantTx,
  companyId: string,
  options: { onlyVisibleToClient?: boolean } = {},
): Promise<DocumentWithVersions[]> {
  const docs = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        activeDocument,
        ...(options.onlyVisibleToClient ? [eq(documents.visibleToClient, true)] : []),
      ),
    )
    .orderBy(asc(documents.category), asc(documents.title));
  if (docs.length === 0) return [];

  const versions = await tx
    .select()
    .from(documentVersions)
    .where(
      inArray(
        documentVersions.documentId,
        docs.map((d) => d.id),
      ),
    )
    .orderBy(desc(documentVersions.version));

  return docs
    .map((doc) => {
      const own = versions.filter((v) => v.documentId === doc.id);
      return {
        ...doc,
        versions: own,
        latest: own[0] ?? null,
        current: own.find((v) => v.status === 'disponivel') ?? null,
      };
    })
    .filter((doc) => !options.onlyVisibleToClient || doc.current !== null);
}

export async function getDocument(tx: TenantTx, documentId: string): Promise<DocumentRow> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), activeDocument));
  if (!row) throw new NotFoundError('document', documentId);
  return row;
}

export async function insertDocument(
  tx: TenantTx,
  tenantId: TenantId,
  input: {
    companyId: string;
    category: DocumentCategory;
    title: string;
    visibleToClient: boolean;
    createdByUserId: UserId | null;
  },
): Promise<DocumentRow> {
  const [row] = await tx
    .insert(documents)
    .values({ tenantId, id: uuidv7(), ...input })
    .returning();
  return row!;
}

export async function updateDocument(
  tx: TenantTx,
  documentId: string,
  patch: { title?: string; category?: DocumentCategory; visibleToClient?: boolean },
): Promise<void> {
  const rows = await tx
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), activeDocument))
    .returning({ id: documents.id });
  if (rows.length === 0) throw new NotFoundError('document', documentId);
}

export async function softDeleteDocument(tx: TenantTx, documentId: string): Promise<void> {
  const rows = await tx
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), activeDocument))
    .returning({ id: documents.id });
  if (rows.length === 0) throw new NotFoundError('document', documentId);
}

export async function nextVersionNumber(tx: TenantTx, documentId: string): Promise<number> {
  const [row] = await tx
    .select({ n: max(documentVersions.version) })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return (row?.n ?? 0) + 1;
}

export async function insertDocumentVersion(
  tx: TenantTx,
  tenantId: TenantId,
  input: {
    id: string;
    documentId: string;
    version: number;
    storageKey: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    uploadedByUserId: UserId | null;
  },
): Promise<DocumentVersion> {
  const [row] = await tx
    .insert(documentVersions)
    .values({ tenantId, ...input })
    .returning();
  return row!;
}

export async function getDocumentVersion(
  tx: TenantTx,
  versionId: string,
): Promise<DocumentVersion> {
  const [row] = await tx.select().from(documentVersions).where(eq(documentVersions.id, versionId));
  if (!row) throw new NotFoundError('document_version', versionId);
  return row;
}

/** Muda o status só se ele ainda for um dos esperados; devolve se mudou (idempotência). */
export async function setVersionStatus(
  tx: TenantTx,
  versionId: string,
  from: VersionStatus[],
  to: VersionStatus,
  extra: { sha256?: string; rejectionReason?: string; sizeBytes?: number } = {},
): Promise<boolean> {
  const rows = await tx
    .update(documentVersions)
    .set({ status: to, ...extra, updatedAt: new Date() })
    .where(and(eq(documentVersions.id, versionId), inArray(documentVersions.status, from)))
    .returning({ id: documentVersions.id });
  return rows.length > 0;
}
