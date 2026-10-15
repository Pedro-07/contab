/**
 * WhatsApp, templates, webhooks e entregas (incremento 3).
 * template_library é global (da plataforma, só leitura para o app); o resto é do tenant,
 * com RLS (migração 0003) e estrangeiras compostas.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import { clientCompanies, contacts } from './clients';
import { tenants } from './tenancy';

export const channelKind = pgEnum('channel_kind', ['whatsapp']);
export const channelStatus = pgEnum('channel_status', [
  'pendente',
  'ativo',
  'erro',
  'desconectado',
]);
export const credentialKind = pgEnum('credential_kind', ['whatsapp_token', 'whatsapp_app_secret']);
export const templateCategory = pgEnum('template_category', ['UTILITY', 'AUTHENTICATION']);
export const tenantTemplateStatus = pgEnum('tenant_template_status', [
  'enviado',
  'aprovado',
  'rejeitado',
  'pausado',
  'desativado',
]);
export const deliveryItemType = pgEnum('delivery_item_type', ['guia', 'documento']);
export const deliveryChannel = pgEnum('delivery_channel', ['whatsapp', 'email']);
export const deliveryTrigger = pgEnum('delivery_trigger', [
  'publicacao',
  'lembrete',
  'vencida',
  'pago',
]);
export const deliveryStatus = pgEnum('delivery_status', [
  'enfileirado',
  'enviado',
  'entregue',
  'lido',
  'falhou',
  'cancelado',
]);

/** Conexão de WhatsApp do escritório (P2, P21). */
export const channels = pgTable(
  'channels',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    kind: channelKind().notNull().default('whatsapp'),
    wabaId: text().notNull(),
    phoneNumberId: text().notNull(),
    displayPhone: text(),
    verifiedName: text(),
    qualityRating: text(),
    status: channelStatus().notNull().default('pendente'),
    statusReason: text(),
    // Só os hashes: a URL secreta do webhook e o verify token são mostrados uma vez (I2).
    webhookKeyHash: text().notNull().unique(),
    verifyTokenHash: text().notNull(),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Um número só pode estar em um escritório: é o que mapeia o webhook no Embedded Signup.
    unique('channels_phone_number_id_unique').on(t.phoneNumberId),
  ],
);

/** Segredos da conexão, cifrados em envelope com o tenant como dado autenticado (ADR 0006). */
export const credentials = pgTable(
  'credentials',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    channelId: uuid().notNull(),
    kind: credentialKind().notNull(),
    ciphertext: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('credentials_channel_kind_unique').on(t.tenantId, t.channelId, t.kind),
    foreignKey({
      name: 'credentials_channel_fk',
      columns: [t.tenantId, t.channelId],
      foreignColumns: [channels.tenantId, channels.id],
    }),
  ],
);

/** Biblioteca da plataforma (global). Gravada pela instalação do banco a partir do código. */
export const templateLibrary = pgTable(
  'template_library',
  {
    id: uuid().primaryKey(),
    key: text().notNull(),
    version: integer().notNull(),
    language: text().notNull(),
    category: templateCategory().notNull(),
    header: text(),
    body: text().notNull(),
    variables: jsonb().$type<Array<{ name: string; example: string }>>().notNull(),
    linkButton: text(),
    emailSubject: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('template_library_key_version_unique').on(t.key, t.version, t.language)],
);

/** Status de cada template da biblioteca no WABA do escritório (I3). */
export const tenantTemplates = pgTable(
  'tenant_templates',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    channelId: uuid().notNull(),
    libraryId: uuid()
      .notNull()
      .references(() => templateLibrary.id),
    metaName: text().notNull(),
    metaTemplateId: text(),
    status: tenantTemplateStatus().notNull().default('enviado'),
    reason: text(),
    enabled: boolean().notNull().default(true),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('tenant_templates_unique').on(t.tenantId, t.channelId, t.libraryId),
    foreignKey({
      name: 'tenant_templates_channel_fk',
      columns: [t.tenantId, t.channelId],
      foreignColumns: [channels.tenantId, channels.id],
    }),
  ],
);

/** Webhook recebido: gravado uma vez (ID externo único) e processado na fila. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    provider: text().notNull(),
    externalId: text().notNull(),
    kind: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('webhook_events_external_unique').on(t.tenantId, t.provider, t.externalId),
  ],
);

/** Cada envio de um item a um contato por um canal (RN13). */
export const deliveries = pgTable(
  'deliveries',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    itemType: deliveryItemType().notNull(),
    itemId: uuid().notNull(),
    companyId: uuid().notNull(),
    contactId: uuid().notNull(),
    channel: deliveryChannel().notNull(),
    trigger: deliveryTrigger().notNull(),
    templateKey: text().notNull(),
    status: deliveryStatus().notNull().default('enfileirado'),
    attempts: integer().notNull().default(0),
    providerMessageId: text(),
    failureReason: text(),
    /** Envio por e-mail que substituiu um WhatsApp que não pôde sair (CA9). */
    fallbackOf: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Idempotência: o mesmo gatilho não envia duas vezes ao mesmo contato pelo mesmo canal.
    unique('deliveries_idempotency').on(t.tenantId, t.itemId, t.contactId, t.channel, t.trigger),
    unique('deliveries_provider_message_unique').on(t.tenantId, t.providerMessageId),
    foreignKey({
      name: 'deliveries_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [clientCompanies.tenantId, clientCompanies.id],
    }),
    foreignKey({
      name: 'deliveries_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('deliveries_item_idx').on(t.tenantId, t.itemId),
    check('deliveries_attempts', sql`${t.attempts} >= 0 and ${t.attempts} <= 10`),
  ],
);
