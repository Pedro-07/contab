import type { GuideSource, GuideStatus, GuideType, TenantId, UserId } from '@contab/domain';
import { and, asc, count, desc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { clientCompanies, guideEvents, guides } from '../schema';
import type { Actor, TenantTx } from '../tenant';

export type Guide = typeof guides.$inferSelect;

export type GuideInput = {
  companyId: string;
  type: GuideType;
  period: string;
  dueDate: string;
  amountCents: number;
  barcode: string | null;
  pixCode: string | null;
  source: GuideSource;
  replacesGuideId?: string | null;
  createdByUserId: UserId | null;
  // Guias geradas pela Serpro (incremento 4) já nascem com o PDF e o número do documento.
  externalNumber?: string | null;
  pdfStorageKey?: string | null;
  pdfSha256?: string | null;
  pdfSizeBytes?: number | null;
  publishedAt?: Date | null;
};

export async function insertGuide(
  tx: TenantTx,
  tenantId: TenantId,
  input: GuideInput & { id?: string; status?: GuideStatus },
): Promise<Guide> {
  const [row] = await tx
    .insert(guides)
    .values({ tenantId, id: input.id ?? uuidv7(), ...input })
    .returning();
  return row!;
}

export async function getGuide(tx: TenantTx, guideId: string): Promise<Guide> {
  const [row] = await tx.select().from(guides).where(eq(guides.id, guideId));
  if (!row) throw new NotFoundError('guide', guideId);
  return row;
}

export type GuideFilter = {
  companyId?: string;
  status?: GuideStatus;
  type?: GuideType;
  period?: string;
  limit?: number;
  offset?: number;
};

export type GuideListRow = Guide & { companyName: string };

export async function listGuides(
  tx: TenantTx,
  filter: GuideFilter = {},
): Promise<{ rows: GuideListRow[]; total: number }> {
  const conditions: SQL[] = [];
  if (filter.companyId) conditions.push(eq(guides.companyId, filter.companyId));
  if (filter.status) conditions.push(eq(guides.status, filter.status));
  if (filter.type) conditions.push(eq(guides.type, filter.type));
  if (filter.period) conditions.push(eq(guides.period, filter.period));
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await tx
    .select({ guide: guides, companyName: clientCompanies.legalName })
    .from(guides)
    .innerJoin(
      clientCompanies,
      and(eq(clientCompanies.tenantId, guides.tenantId), eq(clientCompanies.id, guides.companyId)),
    )
    .where(where)
    .orderBy(desc(guides.dueDate), desc(guides.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);
  const [total] = await tx.select({ n: count() }).from(guides).where(where);
  return {
    rows: rows.map((r) => ({ ...r.guide, companyName: r.companyName })),
    total: total?.n ?? 0,
  };
}

/** Muda o status só se ele ainda for um dos esperados; devolve a guia ou null. */
export async function updateGuideStatus(
  tx: TenantTx,
  guideId: string,
  from: GuideStatus[],
  to: GuideStatus,
  extra: Partial<Pick<Guide, 'publishedAt' | 'paidAt'>> = {},
): Promise<Guide | null> {
  const [row] = await tx
    .update(guides)
    .set({ status: to, ...extra, updatedAt: new Date() })
    .where(and(eq(guides.id, guideId), inArray(guides.status, from)))
    .returning();
  return row ?? null;
}

export async function setGuidePdf(
  tx: TenantTx,
  guideId: string,
  pdf: { storageKey: string; sha256: string | null; sizeBytes: number },
): Promise<void> {
  await tx
    .update(guides)
    .set({
      pdfStorageKey: pdf.storageKey,
      pdfSha256: pdf.sha256,
      pdfSizeBytes: pdf.sizeBytes,
      updatedAt: new Date(),
    })
    .where(eq(guides.id, guideId));
}

export async function recordGuideEvent(
  tx: TenantTx,
  tenantId: TenantId,
  actor: Actor,
  event: { guideId: string; from: GuideStatus | null; to: GuideStatus; reason?: string },
): Promise<void> {
  await tx.insert(guideEvents).values({
    tenantId,
    id: uuidv7(),
    guideId: event.guideId,
    fromStatus: event.from,
    toStatus: event.to,
    actorType: actor.type,
    actorUserId: actor.type === 'member' ? actor.userId : null,
    reason: event.reason ?? null,
  });
}

export async function listGuideEvents(tx: TenantTx, guideId: string) {
  return tx
    .select()
    .from(guideEvents)
    .where(eq(guideEvents.guideId, guideId))
    .orderBy(asc(guideEvents.createdAt));
}

/** Guias ativas que substituíram esta (I5: se a antiga foi paga, a nova é cancelada). */
export async function findReplacements(tx: TenantTx, guideId: string): Promise<Guide[]> {
  return tx
    .select()
    .from(guides)
    .where(
      and(
        eq(guides.replacesGuideId, guideId),
        inArray(guides.status, ['rascunho', 'publicada', 'vencida']),
      ),
    );
}

/** Guias que a régua precisa olhar: ainda pagáveis e com vencimento até a data dada. */
export async function listGuidesForRegua(tx: TenantTx, dueUntil: string): Promise<Guide[]> {
  return tx
    .select()
    .from(guides)
    .where(and(inArray(guides.status, ['publicada', 'vencida']), lte(guides.dueDate, dueUntil)))
    .orderBy(asc(guides.dueDate));
}
