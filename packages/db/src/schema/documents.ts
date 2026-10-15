/**
 * Documentos por empresa, com versões (incremento 2). O arquivo fica no storage, na chave
 * tenants/{tenant_id}/...; o banco guarda só os metadados.
 */
import { DOCUMENT_CATEGORIES } from '@contab/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientCompanies } from './clients';
import { memberships, tenants } from './tenancy';

export const documentCategory = pgEnum('document_category', DOCUMENT_CATEGORIES);
export const documentVersionStatus = pgEnum('document_version_status', [
  'aguardando_envio',
  'verificando',
  'disponivel',
  'rejeitado',
]);

export const documents = pgTable(
  'documents',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    companyId: uuid().notNull(),
    category: documentCategory().notNull(),
    title: text().notNull(),
    visibleToClient: boolean().notNull().default(true),
    // Envia ao cliente (WhatsApp ou e-mail) quando o arquivo fica disponível (incremento 3).
    sendToClient: boolean().notNull().default(false),
    createdByUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'documents_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'documents_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    index('documents_company_idx').on(t.tenantId, t.companyId, t.category),
  ],
);

/** A versão atual é a maior versão `disponivel`; as anteriores ficam guardadas. */
export const documentVersions = pgTable(
  'document_versions',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    documentId: uuid().notNull(),
    version: integer().notNull(),
    storageKey: text().notNull(),
    originalName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    sha256: text(),
    status: documentVersionStatus().notNull().default('aguardando_envio'),
    rejectionReason: text(),
    uploadedByUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('document_versions_number_unique').on(t.tenantId, t.documentId, t.version),
    unique('document_versions_storage_key_unique').on(t.storageKey),
    foreignKey({
      name: 'document_versions_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    foreignKey({
      name: 'document_versions_uploaded_by_fk',
      columns: [t.tenantId, t.uploadedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    // Regra 7 do CLAUDE.md: o arquivo fica sempre sob o prefixo do próprio tenant.
    check(
      'document_versions_storage_key_tenant',
      sql`${t.storageKey} like 'tenants/' || ${t.tenantId}::text || '/%'`,
    ),
    check('document_versions_size', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
  ],
);
