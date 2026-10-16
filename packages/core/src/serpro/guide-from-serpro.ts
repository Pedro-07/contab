/**
 * Organizar e vincular (RN17): a resposta da Serpro vira guia. Antes de gravar, confere o
 * vínculo (CNPJ e competência iguais aos da empresa do tenant) e a leitura do PDF (S3): a
 * linha digitável precisa conferir e trazer o mesmo valor da Serpro. Se algo não conferir,
 * a guia fica em rascunho para o escritório revisar e nada sai para o cliente.
 */
import { readGuidePdf, type DasResult } from '@contab/adapters/serpro';
import { tenantKey } from '@contab/adapters/storage';
import {
  insertGuide,
  raiseAlert,
  recordAudit,
  recordGuideEvent,
  type Company,
  type Guide,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import { formatPeriod, GUIDE_TYPE_LABEL, type FiscalWatchKind } from '@contab/domain';
import { uuidv7 } from 'uuidv7';
import { nowOf } from '../delivery-deps';
import type { FiscalDeps } from './runtime';

export type SerproGuideSource =
  { kind: 'das_mei' | 'das_simples'; das: DasResult } | { kind: 'dctfweb'; pdf: Uint8Array };

/** Guia pronta para gravar, com o PDF já no storage. */
export type PreparedGuide = {
  id: string;
  kind: FiscalWatchKind;
  ok: boolean;
  /** Motivo da revisão (sem dado do cliente). */
  problem: string | null;
  amountCents: number;
  dueDate: string;
  barcode: string | null;
  externalNumber: string | null;
  pdf: { storageKey: string; sha256: string; size: number };
};

/** Confere vínculo e leitura do PDF e grava o PDF no storage do tenant. */
export async function prepareSerproGuide(
  ctx: TenantContext,
  deps: FiscalDeps,
  company: Company,
  period: string,
  source: SerproGuideSource,
): Promise<PreparedGuide | { mismatch: string }> {
  const pdfBytes = source.kind === 'dctfweb' ? source.pdf : source.das.pdf;
  if (source.kind !== 'dctfweb') {
    // Vincular: a resposta tem de ser da empresa e da competência pedidas.
    if (source.das.cnpj !== company.cnpj) return { mismatch: 'CNPJ da resposta diferente' };
    if (source.das.period !== period) return { mismatch: 'competência da resposta diferente' };
  }
  const fields = await readGuidePdf(pdfBytes).catch(() => null);
  let amountCents: number;
  let dueDate: string | null;
  let externalNumber: string | null;
  if (source.kind === 'dctfweb') {
    amountCents = fields?.amountCents ?? 0;
    dueDate = fields?.payUntil ?? null;
    externalNumber = fields?.documentNumber ?? null;
  } else {
    amountCents = source.das.amountCents;
    dueDate = source.das.payUntil;
    externalNumber = source.das.documentNumber;
  }
  let problem: string | null = null;
  let barcode: string | null = fields?.line ?? null;
  if (!fields) problem = 'não foi possível ler o PDF';
  else if (!barcode) problem = 'linha digitável não encontrada no PDF';
  else if (fields.lineAmountCents !== null && fields.lineAmountCents !== amountCents)
    problem = 'valor da linha digitável diferente do valor da Receita';
  else if (amountCents <= 0) problem = 'valor não encontrado';
  else if (!dueDate) problem = 'vencimento não encontrado';
  if (problem && problem.startsWith('valor da linha')) barcode = null;

  const id = uuidv7();
  const storageKey = tenantKey(ctx.tenantId, 'guides', id, uuidv7());
  const stored = await deps.storage.put(ctx.tenantId, storageKey, {
    bytes: pdfBytes,
    contentType: 'application/pdf',
    fileName: `guia-${source.kind}-${formatPeriod(period).replace('/', '-')}.pdf`,
  });
  return {
    id,
    kind: source.kind,
    ok: problem === null,
    problem,
    // A guia exige valor positivo: na revisão sem valor lido, fica 1 centavo até conferir.
    amountCents: amountCents > 0 ? amountCents : 1,
    dueDate: dueDate ?? period,
    barcode,
    externalNumber,
    pdf: { storageKey, ...stored },
  };
}

/**
 * Grava a guia: publicada (I5) e já na fila de entrega, ou em rascunho com alerta de
 * revisão. `replaces` liga a guia nova à substituída no recálculo.
 */
export async function commitSerproGuide(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  company: Company,
  period: string,
  prepared: PreparedGuide,
  replaces: string | null = null,
): Promise<Guide> {
  const now = nowOf(deps);
  const guide = await insertGuide(tx, ctx.tenantId, {
    id: prepared.id,
    companyId: company.id,
    type: prepared.kind,
    period,
    dueDate: prepared.dueDate,
    amountCents: prepared.amountCents,
    barcode: prepared.barcode,
    pixCode: null,
    source: 'serpro',
    replacesGuideId: replaces,
    createdByUserId: null,
    externalNumber: prepared.externalNumber,
    pdfStorageKey: prepared.pdf.storageKey,
    pdfSha256: prepared.pdf.sha256,
    pdfSizeBytes: prepared.pdf.size,
    status: prepared.ok ? 'publicada' : 'rascunho',
    publishedAt: prepared.ok ? now : null,
  });
  await recordGuideEvent(tx, ctx.tenantId, ctx.actor, {
    guideId: guide.id,
    from: null,
    to: guide.status,
    reason: prepared.ok ? 'gerada pela Receita' : `revisão: ${prepared.problem}`,
  });
  await recordAudit(tx, ctx, {
    action: 'guia.gerada_serpro',
    resourceType: 'guide',
    resourceId: guide.id,
    metadata: {
      tipo: guide.type,
      revisao: !prepared.ok,
      recalculo: replaces !== null,
      ambiente: deps.serpro.ambiente,
    },
  });
  if (prepared.ok) {
    await enqueue(deps.boss, ctx, tx, 'delivery.plan', {
      itemType: 'guia',
      itemId: guide.id,
      trigger: 'publicacao',
    });
  } else {
    await raiseAlert(tx, ctx.tenantId, {
      kind: 'guia_revisao',
      message: `A guia ${GUIDE_TYPE_LABEL[guide.type]} de ${formatPeriod(period)} saiu da Receita, mas ${prepared.problem}. Confira o PDF e publique.`,
      resourceType: 'guide',
      resourceId: guide.id,
    });
  }
  return guide;
}
