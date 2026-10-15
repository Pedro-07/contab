/**
 * Guias, eventos de status, links seguros e alertas (incremento 3). Tabelas do tenant,
 * com RLS (migração 0003) e estrangeiras compostas.
 */
import { GUIDE_SOURCES, GUIDE_STATUSES, GUIDE_TYPES } from '@contab/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditActorType, memberships, tenants } from './tenancy';
import { clientCompanies, contacts } from './clients';

export const guideType = pgEnum('guide_type', GUIDE_TYPES);
export const guideStatus = pgEnum('guide_status', GUIDE_STATUSES);
export const guideSource = pgEnum('guide_source', GUIDE_SOURCES);
export const secureLinkItem = pgEnum('secure_link_item', ['guia']);

export const guides = pgTable(
  'guides',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    companyId: uuid().notNull(),
    type: guideType().notNull(),
    /** Competência: sempre dia 1. */
    period: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    amountCents: bigint({ mode: 'number' }).notNull(),
    barcode: text(),
    pixCode: text(),
    status: guideStatus().notNull().default('rascunho'),
    source: guideSource().notNull(),
    replacesGuideId: uuid(),
    pdfStorageKey: text(),
    pdfSha256: text(),
    pdfSizeBytes: bigint({ mode: 'number' }),
    createdByUserId: uuid(),
    publishedAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // RN5: uma guia ativa por empresa, tipo e competência.
    uniqueIndex('guides_active_unique')
      .on(t.tenantId, t.companyId, t.type, t.period)
      .where(sql`${t.status} in ('rascunho', 'publicada', 'vencida')`),
    foreignKey({
      name: 'guides_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'guides_replaces_fk',
      columns: [t.tenantId, t.replacesGuideId],
      foreignColumns: [t.tenantId, t.id],
    }),
    foreignKey({
      name: 'guides_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('guides_amount_positive', sql`${t.amountCents} > 0`),
    check('guides_period_day_one', sql`extract(day from ${t.period}) = 1`),
    check(
      'guides_pdf_key_tenant',
      sql`${t.pdfStorageKey} is null or ${t.pdfStorageKey} like 'tenants/' || ${t.tenantId}::text || '/%'`,
    ),
    index('guides_company_idx').on(t.tenantId, t.companyId, t.period),
    index('guides_due_idx').on(t.tenantId, t.status, t.dueDate),
  ],
);

/** Histórico de status da guia (só inserção). */
export const guideEvents = pgTable(
  'guide_events',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    guideId: uuid().notNull(),
    fromStatus: guideStatus(),
    toStatus: guideStatus().notNull(),
    actorType: auditActorType().notNull(),
    actorUserId: uuid(),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'guide_events_guide_fk',
      columns: [t.tenantId, t.guideId],
      foreignColumns: [guides.tenantId, guides.id],
    }),
    index('guide_events_guide_idx').on(t.tenantId, t.guideId, t.createdAt),
  ],
);

/** Link seguro sem login (RN14). Só o hash do token fica guardado. */
export const secureLinks = pgTable(
  'secure_links',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    itemType: secureLinkItem().notNull(),
    itemId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    accessCount: integer().notNull().default(0),
    maxAccesses: integer().notNull().default(50),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'secure_links_guide_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [guides.tenantId, guides.id],
    }),
  ],
);

/** Registro de cada abertura do link (RN14). Só inserção. */
export const secureLinkAccesses = pgTable(
  'secure_link_accesses',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    linkId: uuid().notNull(),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: inet(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'secure_link_accesses_link_fk',
      columns: [t.tenantId, t.linkId],
      foreignColumns: [secureLinks.tenantId, secureLinks.id],
    }),
  ],
);

/** Código de acesso do portal enviado pelo WhatsApp (P3). Só o hash fica guardado. */
export const portalLoginCodes = pgTable(
  'portal_login_codes',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    contactId: uuid().notNull(),
    codeHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    attempts: integer().notNull().default(0),
    usedAt: timestamp({ withTimezone: true }),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'portal_login_codes_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('portal_login_codes_contact_idx').on(t.tenantId, t.contactId, t.createdAt),
  ],
);

/** Alertas internos do escritório (CA9 e outros). */
export const tenantAlerts = pgTable(
  'tenant_alerts',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    kind: text().notNull(),
    message: text().notNull(),
    resourceType: text(),
    resourceId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('tenant_alerts_open_idx').on(t.tenantId, t.resolvedAt, t.createdAt),
  ],
);
