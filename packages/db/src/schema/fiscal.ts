/**
 * Conexão com a Receita Federal (Serpro), chamadas e rotina fiscal (incremento 4).
 * Tabelas do tenant, com RLS (migração 0004) e estrangeiras compostas.
 */
import {
  FISCAL_CONNECTION_STATUSES,
  FISCAL_MODES,
  FISCAL_WATCH_KINDS,
  FISCAL_WATCH_STATUSES,
} from '@contab/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clientCompanies } from './clients';
import { guides } from './guides';
import { tenants } from './tenancy';

export const fiscalMode = pgEnum('fiscal_mode', FISCAL_MODES);
export const fiscalConnectionStatus = pgEnum(
  'fiscal_connection_status',
  FISCAL_CONNECTION_STATUSES,
);
export const fiscalCredentialKind = pgEnum('fiscal_credential_kind', [
  // Modo plataforma: termo de autorização assinado pelo escritório e o token que ele gera.
  'serpro_termo_xml',
  'serpro_procurador_token',
  // Modo próprio: contrato e e-CNPJ do escritório (exceção do CLAUDE.md).
  'serpro_consumer_key',
  'serpro_consumer_secret',
  'serpro_certificado',
  'serpro_certificado_senha',
]);
export const fiscalCallKind = pgEnum('fiscal_call_kind', [
  'consulta',
  'emissao',
  'declaracao',
  'apoio',
]);
export const fiscalCallStatus = pgEnum('fiscal_call_status', ['em_andamento', 'sucesso', 'falhou']);
export const fiscalWatchKind = pgEnum('fiscal_watch_kind', FISCAL_WATCH_KINDS);
export const fiscalWatchStatus = pgEnum('fiscal_watch_status', FISCAL_WATCH_STATUSES);

/** Conexão do escritório com a Receita (P1): uma por escritório. */
export const fiscalConnections = pgTable(
  'fiscal_connections',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    mode: fiscalMode().notNull(),
    /** CNPJ do escritório: procurador dos clientes (e contratante no modo próprio). */
    officeCnpj: text().notNull(),
    status: fiscalConnectionStatus().notNull().default('pendente'),
    statusReason: text(),
    /** Validade do termo de autorização (modo plataforma). */
    termValidUntil: timestamp({ withTimezone: true }),
    procuradorTokenExpiresAt: timestamp({ withTimezone: true }),
    // Disjuntor por escritório: 5 falhas seguidas em 1 minuto pausam as chamadas.
    breakerFailures: integer().notNull().default(0),
    breakerFirstFailureAt: timestamp({ withTimezone: true }),
    breakerOpenUntil: timestamp({ withTimezone: true }),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('fiscal_connections_one_per_tenant')
      .on(t.tenantId)
      .where(sql`${t.deletedAt} is null`),
    check('fiscal_connections_cnpj_format', sql`${t.officeCnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$'`),
  ],
);

/** Segredos da conexão, cifrados por envelope com o tenant como dado autenticado (ADR 0006). */
export const fiscalCredentials = pgTable(
  'fiscal_credentials',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    connectionId: uuid().notNull(),
    kind: fiscalCredentialKind().notNull(),
    ciphertext: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('fiscal_credentials_kind_unique').on(t.tenantId, t.connectionId, t.kind),
    foreignKey({
      name: 'fiscal_credentials_connection_fk',
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [fiscalConnections.tenantId, fiscalConnections.id],
    }),
  ],
);

/** Cada chamada à Serpro: custo por escritório e idempotência. Sem o conteúdo da resposta. */
export const fiscalCalls = pgTable(
  'fiscal_calls',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    companyId: uuid(),
    guideId: uuid(),
    system: text().notNull(),
    service: text().notNull(),
    kind: fiscalCallKind().notNull(),
    /** rotina, recalculo, buscar_agora, pagamento, conexao */
    purpose: text().notNull(),
    ambiente: text().notNull(),
    idempotencyKey: text(),
    status: fiscalCallStatus().notNull().default('em_andamento'),
    attempts: integer().notNull().default(1),
    httpStatus: integer(),
    errorKind: text(),
    errorCode: text(),
    costCents: integer().notNull().default(0),
    durationMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('fiscal_calls_idempotency')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    foreignKey({
      name: 'fiscal_calls_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'fiscal_calls_guide_fk',
      columns: [t.tenantId, t.guideId],
      foreignColumns: [guides.tenantId, guides.id],
    }),
    index('fiscal_calls_month_idx').on(t.tenantId, t.createdAt),
    index('fiscal_calls_guide_idx').on(t.tenantId, t.guideId, t.createdAt),
    check('fiscal_calls_cost', sql`${t.costCents} >= 0`),
  ],
);

/** Rotina do mês por empresa (S1, S2): da busca da declaração até o pagamento. */
export const fiscalWatches = pgTable(
  'fiscal_watches',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    companyId: uuid().notNull(),
    kind: fiscalWatchKind().notNull(),
    /** Competência: sempre dia 1. */
    period: date({ mode: 'string' }).notNull(),
    status: fiscalWatchStatus().notNull().default('aguardando'),
    nextCheckAt: timestamp({ withTimezone: true }),
    checks: integer().notNull().default(0),
    guideId: uuid(),
    lastError: text(),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('fiscal_watches_unique').on(t.tenantId, t.companyId, t.kind, t.period),
    foreignKey({
      name: 'fiscal_watches_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'fiscal_watches_guide_fk',
      columns: [t.tenantId, t.guideId],
      foreignColumns: [guides.tenantId, guides.id],
    }),
    index('fiscal_watches_due_idx').on(t.tenantId, t.status, t.nextCheckAt),
    check('fiscal_watches_period_day_one', sql`extract(day from ${t.period}) = 1`),
  ],
);
