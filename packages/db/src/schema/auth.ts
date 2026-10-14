import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tabelas globais do Better Auth (ADR 0007). Sem tenant_id, sem RLS.
 * As chaves em camelCase são os nomes de campo que o Better Auth espera.
 */

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    name: text().notNull().default(''),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    phone: text(),
    twoFactorEnabled: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_phone_unique').on(t.phone),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    // Campos nossos (P13, P14): organização ativa e marca do segundo fator.
    activeTenantId: uuid(),
    mfaVerifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactors = pgTable(
  'two_factors',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Segredo TOTP e códigos de recuperação, cifrados pelo Better Auth com BETTER_AUTH_SECRET.
    secret: text().notNull(),
    backupCodes: text().notNull(),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [index('two_factors_user_idx').on(t.userId)],
);

/** Limite de tentativas do Better Auth, no banco porque a Vercel roda várias instâncias. */
export const rateLimits = pgTable('rate_limits', {
  id: uuid().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: 'number' }).notNull(),
});
