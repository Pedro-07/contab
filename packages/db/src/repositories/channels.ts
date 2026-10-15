import type { TenantId } from '@contab/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { channels, credentials, templateLibrary, tenantTemplates } from '../schema';
import type { TenantTx } from '../tenant';

export type Channel = typeof channels.$inferSelect;
export type ChannelStatus = Channel['status'];
export type CredentialKind = (typeof credentials.$inferSelect)['kind'];

const activeChannel = isNull(channels.deletedAt);

/** A conexão de WhatsApp do escritório (uma por escritório no MVP), ou null. */
export async function findWhatsAppChannel(tx: TenantTx): Promise<Channel | null> {
  const [row] = await tx
    .select()
    .from(channels)
    .where(and(eq(channels.kind, 'whatsapp'), activeChannel))
    .orderBy(asc(channels.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getChannel(tx: TenantTx, channelId: string): Promise<Channel> {
  const [row] = await tx
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), activeChannel));
  if (!row) throw new NotFoundError('channel', channelId);
  return row;
}

export async function insertChannel(
  tx: TenantTx,
  tenantId: TenantId,
  input: {
    appId: string;
    wabaId: string;
    phoneNumberId: string;
    webhookKeyHash: string;
    verifyTokenHash: string;
  },
): Promise<Channel> {
  const [row] = await tx
    .insert(channels)
    .values({ tenantId, id: uuidv7(), kind: 'whatsapp', ...input })
    .returning();
  return row!;
}

export async function updateChannel(
  tx: TenantTx,
  channelId: string,
  patch: Partial<
    Pick<
      Channel,
      | 'appId'
      | 'wabaId'
      | 'phoneNumberId'
      | 'displayPhone'
      | 'verifiedName'
      | 'qualityRating'
      | 'status'
      | 'statusReason'
      | 'lastCheckedAt'
      | 'webhookKeyHash'
      | 'verifyTokenHash'
      | 'deletedAt'
    >
  >,
): Promise<void> {
  await tx
    .update(channels)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(channels.id, channelId));
}

/** Grava (ou troca) um segredo cifrado da conexão. */
export async function upsertCredential(
  tx: TenantTx,
  tenantId: TenantId,
  channelId: string,
  kind: CredentialKind,
  ciphertext: string,
): Promise<void> {
  await tx
    .insert(credentials)
    .values({ tenantId, id: uuidv7(), channelId, kind, ciphertext })
    .onConflictDoUpdate({
      target: [credentials.tenantId, credentials.channelId, credentials.kind],
      set: { ciphertext, rotatedAt: new Date() },
    });
}

export async function getCredentials(
  tx: TenantTx,
  channelId: string,
): Promise<Partial<Record<CredentialKind, string>>> {
  const rows = await tx
    .select({ kind: credentials.kind, ciphertext: credentials.ciphertext })
    .from(credentials)
    .where(eq(credentials.channelId, channelId));
  return Object.fromEntries(rows.map((r) => [r.kind, r.ciphertext]));
}

// ---------------------------------------------------------------------------
// Templates (I3)
// ---------------------------------------------------------------------------

export type LibraryTemplate = typeof templateLibrary.$inferSelect;

/** Versão mais nova e ativa de cada template da biblioteca. */
export async function listLibrary(tx: TenantTx): Promise<LibraryTemplate[]> {
  const rows = await tx
    .select()
    .from(templateLibrary)
    .where(eq(templateLibrary.active, true))
    .orderBy(asc(templateLibrary.key), sql`${templateLibrary.version} desc`);
  const latest = new Map<string, LibraryTemplate>();
  for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
  return [...latest.values()];
}

export type TenantTemplate = typeof tenantTemplates.$inferSelect & {
  key: string;
  version: number;
};

export async function listTenantTemplates(
  tx: TenantTx,
  channelId: string,
): Promise<TenantTemplate[]> {
  const rows = await tx
    .select({ t: tenantTemplates, key: templateLibrary.key, version: templateLibrary.version })
    .from(tenantTemplates)
    .innerJoin(templateLibrary, eq(templateLibrary.id, tenantTemplates.libraryId))
    .where(eq(tenantTemplates.channelId, channelId))
    .orderBy(asc(templateLibrary.key));
  return rows.map((r) => ({ ...r.t, key: r.key, version: r.version }));
}

export async function upsertTenantTemplate(
  tx: TenantTx,
  tenantId: TenantId,
  input: {
    channelId: string;
    libraryId: string;
    metaName: string;
    metaTemplateId: string | null;
    status: TenantTemplate['status'];
    reason: string | null;
  },
): Promise<void> {
  await tx
    .insert(tenantTemplates)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoUpdate({
      target: [tenantTemplates.tenantId, tenantTemplates.channelId, tenantTemplates.libraryId],
      set: {
        metaName: input.metaName,
        metaTemplateId: input.metaTemplateId,
        status: input.status,
        reason: input.reason,
        updatedAt: new Date(),
      },
    });
}

/** Atualiza o status pelo nome ou ID na Meta (webhook de status de template). */
export async function setTemplateStatusByMeta(
  tx: TenantTx,
  channelId: string,
  meta: { name?: string; templateId?: string },
  status: TenantTemplate['status'],
  reason: string | null,
): Promise<TenantTemplate | null> {
  const match = meta.templateId
    ? eq(tenantTemplates.metaTemplateId, meta.templateId)
    : eq(tenantTemplates.metaName, meta.name ?? '');
  const [row] = await tx
    .update(tenantTemplates)
    .set({ status, reason, updatedAt: new Date() })
    .where(and(eq(tenantTemplates.channelId, channelId), match))
    .returning();
  if (!row) return null;
  const [lib] = await tx
    .select({ key: templateLibrary.key, version: templateLibrary.version })
    .from(templateLibrary)
    .where(eq(templateLibrary.id, row.libraryId));
  return { ...row, key: lib!.key, version: lib!.version };
}
