/**
 * Guias (incremento 3). Envio avulso como contingência do marco (P23): o escritório
 * cadastra a guia com o PDF, publica e a entrega sai sozinha. Status pela RN1 com I5.
 */
import { tenantKey, type FileStorage, type SignedUpload } from '@contab/adapters/storage';
import {
  cancelQueuedDeliveries,
  findReplacements,
  getCompany,
  getGuide,
  insertGuide,
  listGuideEvents,
  listGuides,
  listItemDeliveries,
  NotFoundError,
  raiseAlert,
  recordAudit,
  recordGuideEvent,
  revokeItemLinks,
  setGuidePdf,
  updateGuideStatus,
  withTenant,
  type Guide,
  type GuideFilter,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  canManageGuides,
  detectFileType,
  FILE_SIGNATURE_BYTES,
  GUIDE_TYPES,
  MAX_DOCUMENT_BYTES,
  nextGuideStatus,
  parseBarcodeLine,
  parseIsoDate,
  parseMoneyToCents,
  parsePeriod,
  parsePixCode,
  type GuideStatus,
  type UserId,
} from '@contab/domain';
import type { PgBoss } from 'pg-boss';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ClientInputError, uuidOrNotFound } from './clients';
import { actorRole, actorUserId, deny, logNotFound } from './guard';

async function requireGuideManager(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageGuides(role))
    await deny(ctx, 'Seu papel não permite alterar guias.', 'guide');
}

async function requireViewer(ctx: TenantContext): Promise<void> {
  if (!actorRole(ctx)) await deny(ctx, 'Sem acesso às guias.', 'guide');
}

const guideSchema = z.object({
  companyId: z.string(),
  type: z.enum(GUIDE_TYPES, { message: 'Escolha o tipo da guia.' }),
  period: z.string().transform((v, c) => {
    const p = parsePeriod(v);
    if (!p) c.addIssue({ code: 'custom', message: 'Competência inválida (use MM/AAAA).' });
    return p ?? '';
  }),
  dueDate: z.string().transform((v, c) => {
    const d = parseIsoDate(v);
    if (!d) c.addIssue({ code: 'custom', message: 'Vencimento inválido.' });
    return d ?? '';
  }),
  amount: z.string().transform((v, c) => {
    const cents = parseMoneyToCents(v);
    if (!cents) c.addIssue({ code: 'custom', message: 'Valor inválido.' });
    return cents ?? 0;
  }),
  barcode: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v?.trim()) return null;
      const line = parseBarcodeLine(v);
      if (!line) c.addIssue({ code: 'custom', message: 'Linha digitável inválida.' });
      return line;
    }),
  pixCode: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v?.trim()) return null;
      const pix = parsePixCode(v);
      if (!pix) c.addIssue({ code: 'custom', message: 'Pix copia e cola inválido.' });
      return pix;
    }),
});

export type GuideFormInput = z.input<typeof guideSchema>;

function isUniqueViolation(error: unknown): boolean {
  return (error as { cause?: { code?: string } }).cause?.code === '23505';
}

/** Cria a guia avulsa em rascunho (RN1: só a avulsa passa por rascunho, I5). */
export async function createGuide(ctx: TenantContext, input: GuideFormInput): Promise<Guide> {
  await requireGuideManager(ctx);
  const parsed = guideSchema.safeParse(input);
  if (!parsed.success)
    throw new ClientInputError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  const data = parsed.data;
  if (!data.barcode && !data.pixCode)
    throw new ClientInputError('Informe a linha digitável ou o Pix copia e cola.');
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(data.companyId, 'client_company'));
      let guide: Guide;
      try {
        guide = await insertGuide(tx, ctx.tenantId, {
          companyId: company.id,
          type: data.type,
          period: data.period,
          dueDate: data.dueDate,
          amountCents: data.amount,
          barcode: data.barcode,
          pixCode: data.pixCode,
          source: 'avulsa',
          createdByUserId: actorUserId(ctx) as UserId | null,
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ClientInputError(
            'Já existe uma guia ativa deste tipo e competência para a empresa (RN5).',
          );
        throw error;
      }
      await recordGuideEvent(tx, ctx.tenantId, ctx.actor, {
        guideId: guide.id,
        from: null,
        to: 'rascunho',
      });
      await recordAudit(tx, ctx, {
        action: 'guia.criada',
        resourceType: 'guide',
        resourceId: guide.id,
        metadata: { tipo: guide.type, origem: 'avulsa' },
      });
      return guide;
    }),
  );
}

/** URL assinada para o navegador enviar o PDF da guia direto ao storage. */
export async function requestGuidePdfUpload(
  ctx: TenantContext,
  storage: FileStorage,
  guideId: string,
  file: { size: number; contentType: string },
): Promise<SignedUpload> {
  await requireGuideManager(ctx);
  if (file.contentType !== 'application/pdf') throw new ClientInputError('Envie a guia em PDF.');
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES)
    throw new ClientInputError('O PDF passa de 10 MB.');
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      if (guide.status !== 'rascunho')
        throw new ClientInputError('Só dá para trocar o PDF de guia em rascunho.');
      const key = tenantKey(ctx.tenantId, 'guides', guide.id, uuidv7());
      await setGuidePdf(tx, guide.id, { storageKey: key, sha256: null, sizeBytes: file.size });
      return storage.presignUpload(ctx.tenantId, key, {
        contentType: 'application/pdf',
        size: file.size,
        fileName: `guia-${guide.type}-${guide.period.slice(0, 7)}.pdf`,
      });
    }),
  );
}

/** Confere o PDF enviado (tamanho, tipo pelo conteúdo) e guarda o hash. */
export async function confirmGuidePdf(
  ctx: TenantContext,
  storage: FileStorage,
  guideId: string,
): Promise<void> {
  await requireGuideManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      const key = guide.pdfStorageKey;
      if (!key) throw new ClientInputError('Envie o PDF da guia.');
      const size = await storage.size(ctx.tenantId, key);
      const type = size
        ? detectFileType(await storage.readStart(ctx.tenantId, key, FILE_SIGNATURE_BYTES))
        : null;
      if (!size || size !== guide.pdfSizeBytes || type !== 'pdf') {
        if (size) await storage.delete(ctx.tenantId, key);
        await setGuidePdf(tx, guide.id, { storageKey: key, sha256: null, sizeBytes: 0 });
        throw new ClientInputError('O arquivo enviado não é um PDF válido. Envie de novo.');
      }
      await setGuidePdf(tx, guide.id, {
        storageKey: key,
        sha256: await storage.sha256(ctx.tenantId, key),
        sizeBytes: size,
      });
    }),
  );
}

async function transition(
  tx: TenantTx,
  ctx: TenantContext,
  guide: Guide,
  action: Parameters<typeof nextGuideStatus>[1],
  reason?: string,
  extra: Partial<Pick<Guide, 'publishedAt' | 'paidAt'>> = {},
): Promise<Guide> {
  const to = nextGuideStatus(guide.status, action);
  if (!to) throw new ClientInputError('Esta guia não pode mudar para esse status.');
  const updated = await updateGuideStatus(tx, guide.id, [guide.status], to, extra);
  if (!updated) throw new ClientInputError('A guia mudou enquanto você agia. Recarregue a página.');
  await recordGuideEvent(tx, ctx.tenantId, ctx.actor, {
    guideId: guide.id,
    from: guide.status,
    to,
    ...(reason ? { reason } : {}),
  });
  return updated;
}

/** Publica a guia e dispara a entrega automática (RN13). Exige o PDF conferido. */
export async function publishGuide(
  ctx: TenantContext,
  boss: PgBoss,
  guideId: string,
): Promise<void> {
  await requireGuideManager(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      if (!guide.pdfSha256) throw new ClientInputError('Envie o PDF da guia antes de publicar.');
      await transition(tx, ctx, guide, 'publicar', undefined, { publishedAt: new Date() });
      await enqueue(boss, ctx, tx, 'delivery.plan', {
        itemType: 'guia',
        itemId: guide.id,
        trigger: 'publicacao',
      });
      await recordAudit(tx, ctx, {
        action: 'guia.publicada',
        resourceType: 'guide',
        resourceId: guide.id,
      });
    }),
  );
}

/**
 * Pagamento confirmado (I5): qualquer guia não cancelada vira paga. Links e envios na fila
 * são encerrados. Se a paga era substituída, a guia ativa que a substituiu é cancelada e o
 * escritório recebe um alerta. Usado pela baixa manual e, depois, pela Serpro.
 */
export async function applyGuidePayment(
  tx: TenantTx,
  ctx: TenantContext,
  boss: PgBoss,
  guide: Guide,
  reason: string,
): Promise<void> {
  const paid = await transition(tx, ctx, guide, 'pagar', reason, { paidAt: new Date() });
  await revokeItemLinks(tx, paid.id);
  await cancelQueuedDeliveries(tx, paid.id);
  if (guide.status === 'substituida') {
    for (const replacement of await findReplacements(tx, guide.id)) {
      await transition(tx, ctx, replacement, 'cancelar', 'guia anterior foi paga');
      await revokeItemLinks(tx, replacement.id);
      await cancelQueuedDeliveries(tx, replacement.id);
      await raiseAlert(tx, ctx.tenantId, {
        kind: 'guia_substituida_paga',
        message:
          'O cliente pagou a guia antiga depois de receber a atualizada. A guia nova foi cancelada.',
        resourceType: 'guide',
        resourceId: replacement.id,
      });
    }
  }
  await enqueue(boss, ctx, tx, 'delivery.plan', {
    itemType: 'guia',
    itemId: paid.id,
    trigger: 'pago',
  });
}

/** Baixa manual, auditada (CLAUDE.md: "a baixa só acontece por webhook ou manualmente"). */
export async function markGuidePaid(
  ctx: TenantContext,
  boss: PgBoss,
  guideId: string,
  reason: string,
): Promise<void> {
  await requireGuideManager(ctx);
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new ClientInputError('Informe como o pagamento foi confirmado.');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      await applyGuidePayment(tx, ctx, boss, guide, why);
      await recordAudit(tx, ctx, {
        action: 'guia.baixa_manual',
        resourceType: 'guide',
        resourceId: guide.id,
        metadata: { status_anterior: guide.status },
      });
    }),
  );
}

export async function cancelGuide(ctx: TenantContext, guideId: string, reason: string) {
  await requireGuideManager(ctx);
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new ClientInputError('Informe o motivo do cancelamento.');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      await transition(tx, ctx, guide, 'cancelar', why);
      await revokeItemLinks(tx, guide.id);
      await cancelQueuedDeliveries(tx, guide.id);
      await recordAudit(tx, ctx, {
        action: 'guia.cancelada',
        resourceType: 'guide',
        resourceId: guide.id,
      });
    }),
  );
}

export async function listTenantGuides(ctx: TenantContext, filter: GuideFilter = {}) {
  await requireViewer(ctx);
  return withTenant(ctx, (tx) => listGuides(tx, filter));
}

export async function getGuideDetail(ctx: TenantContext, guideId: string) {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      const company = await getCompany(tx, guide.companyId);
      const events = await listGuideEvents(tx, guide.id);
      const deliveries = await listItemDeliveries(tx, guide.id);
      return { guide, company, events, deliveries };
    }),
  );
}

/** URL de 5 min do PDF da guia, para a equipe. */
export async function getGuidePdfUrl(
  ctx: TenantContext,
  storage: FileStorage,
  guideId: string,
): Promise<string> {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      if (!guide.pdfStorageKey || !guide.pdfSha256) throw new NotFoundError('guide_pdf', guide.id);
      return storage.presignDownload(ctx.tenantId, guide.pdfStorageKey, {
        fileName: `guia-${guide.type}-${guide.period.slice(0, 7)}.pdf`,
        contentType: 'application/pdf',
      });
    }),
  );
}

export type { GuideStatus };

/** URL de 5 min do comprovante de pagamento da Receita (incremento 4), para a equipe. */
export async function getGuideReceiptUrl(
  ctx: TenantContext,
  storage: FileStorage,
  guideId: string,
): Promise<string> {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const guide = await getGuide(tx, uuidOrNotFound(guideId, 'guide'));
      if (!guide.receiptStorageKey) throw new NotFoundError('guide_receipt', guide.id);
      return storage.presignDownload(ctx.tenantId, guide.receiptStorageKey, {
        fileName: `comprovante-${guide.type}-${guide.period.slice(0, 7)}.pdf`,
        contentType: 'application/pdf',
      });
    }),
  );
}
