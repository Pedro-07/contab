/**
 * Acesso a tabelas globais (sem tenant). Uso restrito pelo lint: autenticação,
 * resolução de tenant, casos de uso de convite e operador.
 */
import { asTenantId, type TenantId, type UserId } from '@contab/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb, type Db } from './internal';
import { securityEvents, sessions, tenants, users } from './schema';

export type Tenant = typeof tenants.$inferSelect;

export async function findTenantBySlug(slug: string, db: Db = getDb()): Promise<Tenant | null> {
  const [row] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)));
  return row ?? null;
}

export async function findTenantById(id: TenantId, db: Db = getDb()): Promise<Tenant | null> {
  const [row] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)));
  return row ?? null;
}

export async function insertTenant(
  input: { slug: string; name: string },
  db: Db = getDb(),
): Promise<Tenant> {
  const [row] = await db
    .insert(tenants)
    .values({ id: uuidv7(), ...input })
    .returning();
  return row!;
}

export type User = typeof users.$inferSelect;

export async function findUserByEmail(email: string, db: Db = getDb()): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  return row ?? null;
}

export async function findUserById(id: UserId, db: Db = getDb()): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

/** Cria o usuário do convite aceito. O e-mail é provado pela posse do token do convite. */
export async function insertUser(
  input: { email: string; name?: string },
  db: Db = getDb(),
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ id: uuidv7(), email: input.email, name: input.name ?? '', emailVerified: true })
    .returning();
  return row!;
}

/**
 * Resolve o tenant de um convite pelo hash do token (função SECURITY DEFINER da migração 0001).
 * O tenant vem de um segredo conferido no servidor, nunca de um tenant_id do navegador.
 */
export async function lookupInvitation(
  tokenHash: string,
  db: Db = getDb(),
): Promise<{ tenantId: TenantId; invitationId: string } | null> {
  const result = await db.execute<{ tenant_id: string; invitation_id: string }>(
    sql`select tenant_id, invitation_id from invitation_lookup(${tokenHash})`,
  );
  const row = result.rows[0];
  return row ? { tenantId: asTenantId(row.tenant_id), invitationId: row.invitation_id } : null;
}

/**
 * Escritório da conexão de WhatsApp de um webhook (I2), pelas funções SECURITY DEFINER da
 * migração 0003: pelo hash da chave secreta da URL ou pelo phone_number_id.
 */
export async function resolveWhatsAppChannel(
  by: { webhookKeyHash: string } | { phoneNumberId: string },
  db: Db = getDb(),
): Promise<{ tenantId: TenantId; channelId: string } | null> {
  const result =
    'webhookKeyHash' in by
      ? await db.execute<{ tenant_id: string; channel_id: string }>(
          sql`select tenant_id, channel_id from channel_by_webhook_key(${by.webhookKeyHash})`,
        )
      : await db.execute<{ tenant_id: string; channel_id: string }>(
          sql`select tenant_id, channel_id from channel_by_phone_number(${by.phoneNumberId})`,
        );
  const row = result.rows[0];
  return row ? { tenantId: asTenantId(row.tenant_id), channelId: row.channel_id } : null;
}

/** Escritórios ativos, para o despacho da régua (job da plataforma, sem dado de tenant). */
export async function listActiveTenantIds(db: Db = getDb()): Promise<TenantId[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(isNull(tenants.deletedAt), sql`${tenants.status} in ('trial', 'active', 'past_due')`),
    );
  return rows.map((r) => asTenantId(r.id));
}

// ---------------------------------------------------------------------------
// Sessões (campos nossos na tabela do Better Auth)
// ---------------------------------------------------------------------------

/**
 * Troca a organização ativa da sessão. A marca do MFA continua: ela prova a identidade
 * da pessoa, não depende do escritório.
 */
export async function setSessionActiveTenant(
  sessionId: string,
  tenantId: TenantId | null,
  db: Db = getDb(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ activeTenantId: tenantId, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/** Marca a sessão como verificada pelo segundo fator (chamado só pelo gancho do Better Auth). */
export async function markSessionMfaVerifiedByToken(
  sessionToken: string,
  db: Db = getDb(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(sessions.token, sessionToken));
}

// ---------------------------------------------------------------------------
// Log de segurança (P15)
// ---------------------------------------------------------------------------

export type SecurityEventType = (typeof securityEvents.$inferInsert)['type'];

export type SecurityEvent = {
  type: SecurityEventType;
  userId?: string | null;
  activeTenantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  details?: Record<string, string | number | boolean | null> | null;
};

/**
 * Grava um evento de segurança. Sem RETURNING: o papel `app` não tem SELECT na tabela.
 * Nunca lança: falha ao registrar não pode mudar a resposta ao usuário.
 */
export async function recordSecurityEvent(event: SecurityEvent, db: Db = getDb()): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      id: uuidv7(),
      type: event.type,
      userId: event.userId ?? null,
      activeTenantId: event.activeTenantId ?? null,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId?.slice(0, 100) ?? null,
      ip: event.ip ?? null,
      requestId: event.requestId ?? null,
      details: event.details ?? null,
    });
  } catch (error) {
    const { logger } = await import('@contab/config/logger');
    logger.error(
      { err: error instanceof Error ? error.message : 'erro' },
      'falha ao gravar security_event',
    );
  }
}

export { getDb, type Db } from './internal';
