import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

export const tenantStatus = pgEnum('tenant_status', [
  'trial',
  'active',
  'past_due',
  'suspended',
  'closed',
]);
export const memberRole = pgEnum('member_role', ['dono', 'admin', 'contador', 'atendente']);
export const auditActorType = pgEnum('audit_actor_type', ['member', 'operator', 'system']);
export const securityEventType = pgEnum('security_event_type', [
  'resource_not_found',
  'forbidden',
  'tenant_switch_denied',
  'login_failed',
  'mfa_failed',
  'invitation_invalid',
  'webhook_signature_invalid',
  'support_mode',
]);

// ---------------------------------------------------------------------------
// Globais (sem RLS)
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: uuid().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    status: tenantStatus().notNull().default('trial'),
    plan: text().notNull().default('piloto'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'tenants_slug_format',
      sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and ${t.slug} not in ('app','api','www','admin','status','mail','suporte','staging','docs')`,
    ),
  ],
);

/**
 * Log de segurança (P15). Global: o papel `app` só insere; o operador lê com `security_reader`.
 * Só identificadores, nunca conteúdo de requisição.
 */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid().primaryKey(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    type: securityEventType().notNull(),
    userId: uuid(),
    activeTenantId: uuid(),
    resourceType: text(),
    resourceId: text(),
    ip: inet(),
    requestId: text(),
    details: jsonb().$type<Record<string, string | number | boolean | null>>(),
  },
  (t) => [index('security_events_user_time_idx').on(t.userId, t.occurredAt)],
);

// ---------------------------------------------------------------------------
// Do tenant: tenant_id NOT NULL, RLS (migração 0001), chave (tenant_id, id)
// ---------------------------------------------------------------------------

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: memberRole().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Sem filtro de deleted_at: é o alvo da estrangeira composta de invitations.
    unique('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    email: text().notNull(),
    role: memberRole().notNull(),
    // Hash SHA-256 do token. Nulo até o job de envio gerar o token.
    tokenHash: text().unique(),
    // Nulo quando o convite foi criado pelo operador (pnpm tenant:create).
    invitedByUserId: uuid(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedByUserId: uuid().references(() => users.id),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Estrangeira composta: quem convidou é membro do mesmo tenant.
    foreignKey({
      name: 'invitations_invited_by_fk',
      columns: [t.tenantId, t.invitedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id),
  timezone: text().notNull().default('America/Fortaleza'),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    id: uuid().notNull(),
    actorType: auditActorType().notNull(),
    actorUserId: uuid(),
    action: text().notNull(),
    resourceType: text(),
    resourceId: text(),
    ip: inet(),
    requestId: text(),
    metadata: jsonb().$type<Record<string, string | number | boolean | null>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('audit_logs_tenant_time_idx').on(t.tenantId, t.createdAt),
  ],
);
