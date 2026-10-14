/**
 * Empresas-clientes, contatos e acesso ao portal (incremento 2). Todas do tenant:
 * tenant_id NOT NULL, RLS (migração 0002), chave (tenant_id, id) e estrangeiras compostas.
 */
import {
  COMPANY_STATUSES,
  CONSENT_CHANNELS,
  CONSENT_SOURCES,
  CONTACT_ROLES,
  POA_STATUSES,
  PREFERRED_CHANNELS,
  TAX_REGIMES,
} from '@contab/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { memberships, tenants } from './tenancy';

export const taxRegime = pgEnum('tax_regime', TAX_REGIMES);
export const companyStatus = pgEnum('company_status', COMPANY_STATUSES);
export const poaStatus = pgEnum('poa_status', POA_STATUSES);
export const contactRole = pgEnum('contact_role', CONTACT_ROLES);
export const preferredChannel = pgEnum('preferred_channel', PREFERRED_CHANNELS);
export const consentChannel = pgEnum('consent_channel', CONSENT_CHANNELS);
export const consentStatus = pgEnum('consent_status', ['opt_in', 'opt_out']);
export const consentSource = pgEnum('consent_source', CONSENT_SOURCES);

export const clientCompanies = pgTable(
  'client_companies',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    // Sem máscara; numérico ou alfanumérico da Receita.
    cnpj: text().notNull(),
    legalName: text().notNull(),
    tradeName: text(),
    regime: taxRegime().notNull(),
    stateRegistration: text(),
    municipalRegistration: text(),
    status: companyStatus().notNull().default('ativa'),
    poaStatus: poaStatus().notNull().default('nao_verificada'),
    poaValidUntil: date({ mode: 'string' }),
    responsibleUserId: uuid(),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('client_companies_tenant_cnpj_unique')
      .on(t.tenantId, t.cnpj)
      .where(sql`${t.deletedAt} is null`),
    check('client_companies_cnpj_format', sql`${t.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$'`),
    // O responsável é membro do mesmo escritório.
    foreignKey({
      name: 'client_companies_responsible_fk',
      columns: [t.tenantId, t.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    name: text().notNull(),
    // E.164
    phone: text(),
    email: text(),
    preferredChannel: preferredChannel().notNull().default('whatsapp'),
    // Resumo do consentimento; o histórico fica em contact_consents (RN7).
    whatsappOptInAt: timestamp({ withTimezone: true }),
    emailOptInAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('contacts_tenant_phone_unique')
      .on(t.tenantId, t.phone)
      .where(sql`${t.phone} is not null and ${t.deletedAt} is null`),
    index('contacts_tenant_email_idx').on(t.tenantId, sql`lower(${t.email})`),
    check('contacts_phone_e164', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('contacts_phone_or_email', sql`${t.phone} is not null or ${t.email} is not null`),
  ],
);

/** Histórico de consentimento. O app só insere (migração 0002). */
export const contactConsents = pgTable(
  'contact_consents',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    contactId: uuid().notNull(),
    channel: consentChannel().notNull(),
    status: consentStatus().notNull(),
    source: consentSource().notNull(),
    actorUserId: uuid(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'contact_consents_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: 'contact_consents_actor_fk',
      columns: [t.tenantId, t.actorUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    index('contact_consents_contact_idx').on(t.tenantId, t.contactId, t.occurredAt),
  ],
);

export const companyContacts = pgTable(
  'company_contacts',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    companyId: uuid().notNull(),
    contactId: uuid().notNull(),
    role: contactRole().notNull().default('outro'),
    receivesDeliveries: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Sem filtro: desfazer o vínculo marca deleted_at, e vincular de novo reativa a linha.
    unique('company_contacts_unique').on(t.tenantId, t.companyId, t.contactId),
    foreignKey({
      name: 'company_contacts_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'company_contacts_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('company_contacts_contact_idx').on(t.tenantId, t.contactId),
  ],
);

/** Quem acessa a empresa no portal (RN9). A pessoa do portal é o próprio contato. */
export const clientAccess = pgTable(
  'client_access',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    contactId: uuid().notNull(),
    companyId: uuid().notNull(),
    grantedByUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Sem filtro: alvo da estrangeira de portal_sessions; conceder de novo limpa revoked_at.
    unique('client_access_unique').on(t.tenantId, t.contactId, t.companyId),
    foreignKey({
      name: 'client_access_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: 'client_access_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'client_access_granted_by_fk',
      columns: [t.tenantId, t.grantedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);

/**
 * Sessão do portal, presa ao tenant do subdomínio (P16). O token fica só como hash.
 * A empresa ativa precisa ter acesso concedido ao contato (estrangeira composta).
 */
export const portalSessions = pgTable(
  'portal_sessions',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    contactId: uuid().notNull(),
    activeCompanyId: uuid(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'portal_sessions_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: 'portal_sessions_active_company_fk',
      columns: [t.tenantId, t.contactId, t.activeCompanyId],
      foreignColumns: [clientAccess.tenantId, clientAccess.contactId, clientAccess.companyId],
    }),
  ],
);
