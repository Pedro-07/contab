/**
 * Rotina fiscal (incremento 4, RN16 e RN17), só no worker:
 * - serpro.tenant: cria a rotina do mês de cada empresa e enfileira as consultas vencidas;
 * - serpro.watch: MEI gera no dia (S2); Simples e DCTFWeb consultam a declaração a cada dia
 *   útil até achar (S1) e então geram; depois acompanha o pagamento (PAGTOWEB, I5);
 * - serpro.recalc: DAS vencido gera guia nova e a anterior vira substituída (RN2, CA2);
 * - serpro.connect: ativa a conexão (termo de autorização ou credenciais próprias).
 */
import {
  emitDasMei,
  emitDasSimples,
  emitDctfwebGuide,
  findDctfwebReceipt,
  findPayments,
  findSimplesDeclaration,
  paymentReceipt,
  SerproError,
  type ServiceContext,
} from '@contab/adapters/serpro';
import { tenantKey } from '@contab/adapters/storage';
import {
  cancelQueuedDeliveries,
  countRecalcsSince,
  ensureWatch,
  findActiveGuide,
  findFiscalConnection,
  findWatch,
  finishFiscalCall,
  getCompany,
  getGuide,
  getTenantSettings,
  getWatch,
  listActiveCompaniesForRoutine,
  listDueWatches,
  listWatchDocumentGuides,
  raiseAlert,
  recordAudit,
  recordGuideEvent,
  revokeItemLinks,
  setGuideReceipt,
  updateFiscalConnection,
  updateGuideStatus,
  updateWatch,
  type Company,
  type FiscalConnection,
  type FiscalWatch,
  type Guide,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  canRecalculate,
  declarationSearchExpired,
  emissionKey,
  formatPeriod,
  GUIDE_TYPE_LABEL,
  isBusinessDay,
  localDateAt,
  localParts,
  nextBusinessDay,
  nextCheckAt,
  nextPaymentCheck,
  openPeriod,
  watchKindForRegime,
  watchStartAt,
  FISCAL_CHECK_HOUR,
  type FiscalWatchKind,
} from '@contab/domain';
import { uuidv7 } from 'uuidv7';
import { applyGuidePayment } from '../guides';
import { nowOf } from '../delivery-deps';
import {
  commitSerproGuide,
  prepareSerproGuide,
  type PreparedGuide,
  type SerproGuideSource,
} from './guide-from-serpro';
import {
  ensureProcuradorToken,
  serproCall,
  serviceContextFor,
  type CallOutcome,
  type FiscalDeps,
} from './runtime';

/** Espera depois de um erro temporário (o disjuntor cuida das quedas maiores). */
const RETRY_AFTER_MS = 60 * 60_000;

/** Código do erro quando o PDF que veio da Receita não pôde ser guardado no storage. */
const STORAGE_FAILURE = 'armazenamento';

/**
 * Prepara a guia (grava o PDF no storage). Se o storage falhar, a chamada vira `falhou`
 * (o custo fica registrado e a próxima tentativa emite de novo) e o erro volta como
 * temporário, em vez de desfazer a transação e apagar o registro da chamada.
 */
async function prepareOrFail(
  tx: TenantTx,
  callId: string,
  prepare: () => ReturnType<typeof prepareSerproGuide>,
): Promise<Awaited<ReturnType<typeof prepareSerproGuide>> | SerproError> {
  try {
    return await prepare();
  } catch {
    await finishFiscalCall(tx, callId, { status: 'falhou', errorKind: STORAGE_FAILURE });
    return new SerproError('indisponivel', true, null, STORAGE_FAILURE);
  }
}
/** Recálculo: espera entre as 3 tentativas (CA2). */
export const RECALC_RETRY_SECONDS = 60;
/** Antecedência do aviso de termo de autorização perto de vencer. */
const TERM_WARNING_DAYS = 15;

async function settingsOf(tx: TenantTx) {
  const row = await getTenantSettings(tx);
  return {
    timezone: row?.timezone ?? 'America/Fortaleza',
    meiGenerationDay: row?.meiGenerationDay ?? 5,
  };
}

/** Conexão pronta para chamar: ativa e com termo dentro da validade. */
function connectionUsable(
  connection: FiscalConnection | null,
  now: Date,
): connection is FiscalConnection {
  if (!connection || connection.status !== 'ativa') return false;
  return !connection.termValidUntil || connection.termValidUntil > now;
}

// ---------------------------------------------------------------------------
// serpro.tenant
// ---------------------------------------------------------------------------

export type TenantRoutineResult = { criadas: number; enfileiradas: number };

export async function runSerproTenant(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
): Promise<TenantRoutineResult> {
  const result: TenantRoutineResult = { criadas: 0, enfileiradas: 0 };
  const now = nowOf(deps);
  const connection = await findFiscalConnection(tx);
  if (!connection || connection.status !== 'ativa') return result;

  // Termo de autorização (modo plataforma): avisa antes de vencer e para quando vence.
  if (connection.termValidUntil) {
    if (connection.termValidUntil <= now) {
      await updateFiscalConnection(tx, connection.id, {
        status: 'erro',
        statusReason: 'Termo de autorização vencido.',
      });
      await raiseAlert(tx, ctx.tenantId, {
        kind: 'serpro_termo_vencido',
        message:
          'O termo de autorização da Receita venceu. As guias não saem sozinhas até enviar um novo em Conexões › Receita Federal.',
      });
      return result;
    }
    if (connection.termValidUntil.getTime() - now.getTime() < TERM_WARNING_DAYS * 86_400_000)
      await raiseAlert(tx, ctx.tenantId, {
        kind: 'serpro_termo_vencendo',
        message:
          'O termo de autorização da Receita vence em menos de 15 dias. Envie um novo em Conexões › Receita Federal.',
      });
  }

  const settings = await settingsOf(tx);
  const period = openPeriod(localParts(now, settings.timezone).date);
  for (const company of await listActiveCompaniesForRoutine(tx)) {
    const kind = watchKindForRegime(company.regime);
    const created = await ensureWatch(tx, ctx.tenantId, {
      companyId: company.id,
      kind,
      period,
      nextCheckAt: watchStartAt(kind, period, settings.meiGenerationDay, settings.timezone),
    });
    if (created) result.criadas++;
  }

  for (const watch of await listDueWatches(tx, now)) {
    // A consulta fica "reservada" por 1 hora: o despacho seguinte não enfileira de novo.
    await updateWatch(tx, watch.id, { nextCheckAt: new Date(now.getTime() + RETRY_AFTER_MS) });
    await enqueue(
      deps.boss,
      ctx,
      tx,
      'serpro.watch',
      { watchId: watch.id, trigger: 'rotina' },
      { singletonKey: `serpro.watch:${watch.id}`, retryLimit: 2 },
    );
    result.enfileiradas++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// serpro.watch
// ---------------------------------------------------------------------------

export type WatchOutcome =
  | 'sem_conexao'
  | 'aguardando'
  | 'gerada'
  | 'revisao'
  | 'paga'
  | 'desistiu'
  | 'erro'
  | 'nada_a_fazer';

function emissionService(kind: FiscalWatchKind) {
  if (kind === 'das_mei') return { system: 'PGMEI', service: 'GERARDASPDF21' };
  if (kind === 'das_simples') return { system: 'PGDASD', service: 'GERARDAS12' };
  return { system: 'DCTFWEB', service: 'GERARGUIA31' };
}

async function emit(
  s: ServiceContext,
  kind: FiscalWatchKind,
  period: string,
  consolidationDate: string | null = null,
): Promise<SerproGuideSource> {
  if (kind === 'das_mei') return { kind, das: await emitDasMei(s, { period, consolidationDate }) };
  if (kind === 'das_simples')
    return { kind, das: await emitDasSimples(s, { period, consolidationDate }) };
  return { kind, pdf: await emitDctfwebGuide(s, period) };
}

/** Grava o erro na rotina e agenda a próxima tentativa. */
async function failWatch(
  tx: TenantTx,
  deps: FiscalDeps,
  watch: FiscalWatch,
  outcome: Exclude<CallOutcome<unknown>, { ok: true }>,
  timezone: string,
): Promise<WatchOutcome> {
  const now = nowOf(deps);
  if ('busy' in outcome) return 'nada_a_fazer';
  if ('done' in outcome) return 'nada_a_fazer';
  const error = outcome.error;
  const next = error.temporary
    ? new Date(
        Math.max(
          now.getTime() + RETRY_AFTER_MS,
          error.code === 'disjuntor' ? now.getTime() + 15 * 60_000 : 0,
        ),
      )
    : nextCheckAt(now, timezone);
  await updateWatch(tx, watch.id, {
    lastError: describeError(error),
    lastCheckedAt: now,
    nextCheckAt: next,
  });
  return 'erro';
}

export function describeError(error: SerproError): string {
  switch (error.kind) {
    case 'limite':
      return 'Limite de consultas da Receita atingido; tenta de novo mais tarde.';
    case 'indisponivel':
      if (error.code === STORAGE_FAILURE)
        return 'A Receita gerou a guia, mas o PDF não foi guardado; tenta de novo mais tarde.';
      return error.code === 'disjuntor'
        ? 'Consultas pausadas: a Receita não estava respondendo.'
        : 'A Receita não respondeu; tenta de novo mais tarde.';
    case 'credencial':
      return 'Credenciais recusadas pela Receita.';
    case 'procuracao':
      return 'Falta procuração eletrônica desta empresa para o escritório.';
    case 'nao_encontrado':
      return 'A Receita não encontrou o que foi pedido.';
    case 'dados':
      return 'A Receita recusou o pedido (dados inválidos).';
    case 'resposta':
      return 'Resposta da Receita em formato inesperado.';
  }
}

export async function runSerproWatch(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  watchId: string,
  trigger: 'rotina' | 'buscar_agora',
): Promise<WatchOutcome> {
  const now = nowOf(deps);
  const watch = await getWatch(tx, watchId);
  // A empresa é lida no tenant do contexto: o contribuinte nunca vem do pedido.
  const company = await getCompany(tx, watch.companyId);
  const settings = await settingsOf(tx);
  const connection = await findFiscalConnection(tx);
  if (!connectionUsable(connection, now)) {
    await updateWatch(tx, watch.id, {
      lastError: 'Conexão com a Receita inativa.',
      nextCheckAt: nextCheckAt(now, settings.timezone),
    });
    return 'sem_conexao';
  }
  if (company.status !== 'ativa' || company.deletedAt) return 'nada_a_fazer';
  if (watch.status !== 'aguardando' && watch.status !== 'gerada') return 'nada_a_fazer';

  const token = await ensureProcuradorToken(tx, ctx, deps, connection);
  if (!token.ok)
    return failWatch(
      tx,
      deps,
      watch,
      { ok: false, error: token.error, call: null },
      settings.timezone,
    );
  const s = await serviceContextFor(tx, ctx, deps, connection, company.cnpj);
  const purpose = trigger === 'buscar_agora' ? 'buscar_agora' : 'rotina';

  if (watch.status === 'gerada')
    return checkPayment(tx, ctx, deps, connection, s, watch, company, settings.timezone, purpose);

  const today = localParts(now, settings.timezone).date;
  // Simples e DCTFWeb: só gera depois de achar a declaração do mês (S1).
  if (watch.kind !== 'das_mei') {
    const found =
      watch.kind === 'das_simples'
        ? await serproCall(
            tx,
            ctx,
            deps,
            connection,
            {
              companyId: company.id,
              system: 'PGDASD',
              service: 'CONSULTIMADECREC14',
              kind: 'consulta',
              purpose,
            },
            () => findSimplesDeclaration(s, watch.period),
          )
        : await serproCall(
            tx,
            ctx,
            deps,
            connection,
            {
              companyId: company.id,
              system: 'DCTFWEB',
              service: 'CONSRECIBO32',
              kind: 'consulta',
              purpose,
            },
            () => findDctfwebReceipt(s, watch.period),
          );
    if (!found.ok) return failWatch(tx, deps, watch, found, settings.timezone);
    if (!found.value) {
      if (declarationSearchExpired(watch.period, today)) {
        await updateWatch(tx, watch.id, {
          status: 'desistiu',
          lastError: 'Declaração do mês não encontrada até o vencimento.',
          lastCheckedAt: now,
          checks: watch.checks + 1,
          nextCheckAt: null,
        });
        await raiseAlert(tx, ctx.tenantId, {
          kind: 'declaracao_nao_encontrada',
          message: `A declaração de ${formatPeriod(watch.period)} (${GUIDE_TYPE_LABEL[watch.kind]}) não apareceu na Receita até o vencimento.`,
          resourceType: 'client_company',
          resourceId: company.id,
        });
        return 'desistiu';
      }
      await updateWatch(tx, watch.id, {
        lastError: null,
        lastCheckedAt: now,
        checks: watch.checks + 1,
        nextCheckAt: nextCheckAt(now, settings.timezone),
      });
      return 'aguardando';
    }
  }

  // Já existe guia ativa (ex.: enviada à mão como contingência): não gera outra (RN5).
  const existing = await findActiveGuide(tx, company.id, watch.kind, watch.period);
  if (existing) {
    await updateWatch(tx, watch.id, {
      status: existing.status === 'rascunho' ? 'revisao' : 'gerada',
      guideId: existing.id,
      lastError: null,
      lastCheckedAt: now,
      nextCheckAt: paymentCheckAt(existing.dueDate, today, settings.timezone),
    });
    return 'gerada';
  }

  const service = emissionService(watch.kind);
  const emitted = await serproCall(
    tx,
    ctx,
    deps,
    connection,
    {
      companyId: company.id,
      ...service,
      kind: 'emissao',
      purpose,
      idempotencyKey: emissionKey({
        companyId: company.id,
        kind: watch.kind,
        period: watch.period,
      }),
    },
    () => emit(s, watch.kind, watch.period),
  );
  if (!emitted.ok) return failWatch(tx, deps, watch, emitted, settings.timezone);
  return storeGuide(
    tx,
    ctx,
    deps,
    watch,
    company,
    emitted.value,
    emitted.call.id,
    today,
    settings.timezone,
  );
}

function paymentCheckAt(dueDate: string, today: string, timezone: string): Date | null {
  const next = nextPaymentCheck(today, dueDate);
  return next ? localDateAt(next, FISCAL_CHECK_HOUR, timezone) : null;
}

async function storeGuide(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  watch: FiscalWatch,
  company: Company,
  source: SerproGuideSource,
  callId: string,
  today: string,
  timezone: string,
): Promise<WatchOutcome> {
  const now = nowOf(deps);
  const prepared = await prepareOrFail(tx, callId, () =>
    prepareSerproGuide(ctx, deps, company, watch.period, source),
  );
  if (prepared instanceof SerproError)
    return failWatch(tx, deps, watch, { ok: false, error: prepared, call: null }, timezone);
  if ('mismatch' in prepared) {
    // Sem vínculo, nada é gravado nem enviado (RN17).
    await updateWatch(tx, watch.id, {
      status: 'revisao',
      lastError: `Resposta da Receita não confere com a empresa (${prepared.mismatch}).`,
      lastCheckedAt: now,
      nextCheckAt: null,
    });
    await raiseAlert(tx, ctx.tenantId, {
      kind: 'serpro_vinculo',
      message: `A resposta da Receita para ${GUIDE_TYPE_LABEL[watch.kind]} de ${formatPeriod(watch.period)} não confere com a empresa. Nada foi enviado ao cliente.`,
      resourceType: 'client_company',
      resourceId: company.id,
    });
    return 'revisao';
  }
  const guide = await commitSerproGuide(tx, ctx, deps, company, watch.period, prepared);
  await linkCall(tx, callId, guide.id);
  await updateWatch(tx, watch.id, {
    status: prepared.ok ? 'gerada' : 'revisao',
    guideId: guide.id,
    lastError: prepared.ok ? null : `Revisão: ${prepared.problem}.`,
    lastCheckedAt: now,
    checks: watch.checks + 1,
    nextCheckAt: prepared.ok ? paymentCheckAt(guide.dueDate, today, timezone) : null,
  });
  return prepared.ok ? 'gerada' : 'revisao';
}

async function linkCall(tx: TenantTx, callId: string, guideId: string) {
  await finishFiscalCall(tx, callId, { status: 'sucesso', guideId });
}

// ---------------------------------------------------------------------------
// Pagamento (PAGTOWEB)
// ---------------------------------------------------------------------------

async function checkPayment(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
  s: ServiceContext,
  watch: FiscalWatch,
  company: Company,
  timezone: string,
  purpose: 'rotina' | 'buscar_agora',
): Promise<WatchOutcome> {
  const now = nowOf(deps);
  const today = localParts(now, timezone).date;
  const docs = await listWatchDocumentGuides(tx, {
    companyId: company.id,
    type: watch.kind,
    period: watch.period,
  });
  if (!docs.length) {
    await updateWatch(tx, watch.id, { status: 'desistiu', nextCheckAt: null, lastCheckedAt: now });
    return 'desistiu';
  }
  const found = await serproCall(
    tx,
    ctx,
    deps,
    connection,
    {
      companyId: company.id,
      system: 'PAGTOWEB',
      service: 'PAGAMENTOS71',
      kind: 'consulta',
      purpose: purpose === 'rotina' ? 'pagamento' : purpose,
    },
    () =>
      findPayments(
        s,
        docs.map((g) => g.externalNumber!),
      ),
  );
  if (!found.ok) return failWatch(tx, deps, watch, found, timezone);
  const paidNumbers = new Set(found.value.map((p) => p.documentNumber));
  const paid = docs.filter((g) => paidNumbers.has(g.externalNumber!));
  if (!paid.length) {
    const latest = docs.reduce((a, b) => (a.dueDate > b.dueDate ? a : b));
    const next = paymentCheckAt(latest.dueDate, today, timezone);
    await updateWatch(tx, watch.id, {
      status: next ? 'gerada' : 'desistiu',
      lastError: null,
      lastCheckedAt: now,
      checks: watch.checks + 1,
      nextCheckAt: next,
    });
    return next ? 'gerada' : 'desistiu';
  }
  for (const guide of paid) {
    // I5: pagamento sempre vale, até de guia substituída (a nova é cancelada).
    const fresh = await getGuide(tx, guide.id);
    if (fresh.status !== 'paga' && fresh.status !== 'cancelada')
      await applyGuidePayment(tx, ctx, deps.boss, fresh, 'pagamento confirmado na Receita');
    await recordAudit(tx, ctx, {
      action: 'guia.baixa_automatica',
      resourceType: 'guide',
      resourceId: guide.id,
      metadata: { origem: 'PAGTOWEB' },
    });
    await storeReceipt(tx, ctx, deps, connection, s, company, fresh);
  }
  await updateWatch(tx, watch.id, {
    status: 'paga',
    guideId: paid[0]!.id,
    lastError: null,
    lastCheckedAt: now,
    nextCheckAt: null,
  });
  return 'paga';
}

/** Comprovante de pagamento no arquivo do cliente. Falha aqui não desfaz a baixa. */
async function storeReceipt(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
  s: ServiceContext,
  company: Company,
  guide: Guide,
): Promise<void> {
  if (guide.receiptStorageKey || !guide.externalNumber) return;
  const outcome = await serproCall(
    tx,
    ctx,
    deps,
    connection,
    {
      companyId: company.id,
      guideId: guide.id,
      system: 'PAGTOWEB',
      service: 'COMPARRECADACAO72',
      kind: 'emissao',
      purpose: 'pagamento',
      idempotencyKey: `comprovante:${guide.id}`,
    },
    () => paymentReceipt(s, guide.externalNumber!),
  );
  if (!outcome.ok) return;
  const key = tenantKey(ctx.tenantId, 'guides', guide.id, `comprovante-${uuidv7()}`);
  try {
    const stored = await deps.storage.put(ctx.tenantId, key, {
      bytes: outcome.value,
      contentType: 'application/pdf',
      fileName: `comprovante-${guide.type}-${formatPeriod(guide.period).replace('/', '-')}.pdf`,
    });
    await setGuideReceipt(tx, guide.id, { storageKey: key, sha256: stored.sha256 });
  } catch {
    // A baixa continua valendo: a guia só fica sem o comprovante e a chamada, `falhou`.
    await finishFiscalCall(tx, outcome.call.id, { status: 'falhou', errorKind: STORAGE_FAILURE });
  }
}

// ---------------------------------------------------------------------------
// serpro.recalc (RN2, CA2)
// ---------------------------------------------------------------------------

export type RecalcOutcome =
  'recalculada' | 'recusado' | 'revisao' | 'tentar_de_novo' | 'pedido_manual' | 'nada_a_fazer';

/** Data de consolidação: hoje, se for dia útil; senão, o próximo dia útil. */
function consolidationDate(today: string): string {
  return isBusinessDay(today) ? today : nextBusinessDay(today);
}

export async function runSerproRecalc(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  input: { guideId: string; requestedBy: 'cliente' | 'escritorio'; attempt: number },
): Promise<RecalcOutcome> {
  const now = nowOf(deps);
  const settings = await settingsOf(tx);
  const old = await getGuide(tx, input.guideId);
  const company = await getCompany(tx, old.companyId);
  const today = localParts(now, settings.timezone).date;
  const dayStart = localDateAt(today, 0, settings.timezone);
  const used = await countRecalcsSince(tx, old.id, dayStart);
  // A primeira tentativa conta no limite; as repetições do mesmo pedido não.
  const check = canRecalculate(old, input.attempt === 1 ? used : Math.max(0, used - 1));
  if (!check.ok || old.type === 'dctfweb') return 'recusado';

  const connection = await findFiscalConnection(tx);
  if (!connectionUsable(connection, now))
    return manualRequest(tx, ctx, old, 'conexão com a Receita inativa');
  const token = await ensureProcuradorToken(tx, ctx, deps, connection);
  if (!token.ok) return retryOrManual(tx, ctx, deps, old, input, token.error);
  const s = await serviceContextFor(tx, ctx, deps, connection, company.cnpj);
  const kind = old.type as 'das_mei' | 'das_simples';
  const date = consolidationDate(today);
  const emitted = await serproCall(
    tx,
    ctx,
    deps,
    connection,
    {
      companyId: company.id,
      guideId: old.id,
      ...emissionService(kind),
      kind: 'emissao',
      purpose: 'recalculo',
      idempotencyKey: emissionKey({
        companyId: company.id,
        kind,
        period: old.period,
        consolidationDate: date,
      }),
    },
    () => emit(s, kind, old.period, date),
  );
  if (!emitted.ok) {
    if ('error' in emitted) return retryOrManual(tx, ctx, deps, old, input, emitted.error);
    return 'nada_a_fazer';
  }

  const prepared = await prepareOrFail(tx, emitted.call.id, () =>
    prepareSerproGuide(ctx, deps, company, old.period, emitted.value),
  );
  if (prepared instanceof SerproError) return retryOrManual(tx, ctx, deps, old, input, prepared);
  if ('mismatch' in prepared || !prepared.ok) {
    await raiseAlert(tx, ctx.tenantId, {
      kind: 'recalculo_revisao',
      message: `O recálculo da guia ${GUIDE_TYPE_LABEL[old.type]} de ${formatPeriod(old.period)} não conferiu. A guia anterior continua com o cliente; confira.`,
      resourceType: 'guide',
      resourceId: old.id,
    });
    return 'revisao';
  }
  const replacement = await substitute(tx, ctx, deps, company, old, prepared);
  await linkCall(tx, emitted.call.id, replacement.id);
  const watch = await findWatchFor(tx, old);
  if (watch)
    await updateWatch(tx, watch.id, {
      status: 'gerada',
      guideId: replacement.id,
      nextCheckAt: paymentCheckAt(replacement.dueDate, today, settings.timezone),
    });
  await recordAudit(tx, ctx, {
    action: 'guia.recalculada',
    resourceType: 'guide',
    resourceId: replacement.id,
    metadata: { anterior: old.id, pedido_por: input.requestedBy },
  });
  return 'recalculada';
}

/** A antiga vira substituída (links e envios encerrados) e a nova entra publicada. */
async function substitute(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  company: Company,
  old: Guide,
  prepared: PreparedGuide,
): Promise<Guide> {
  const updated = await updateGuideStatus(tx, old.id, ['vencida'], 'substituida');
  if (!updated) throw new Error('guia mudou durante o recálculo');
  await recordGuideEvent(tx, ctx.tenantId, ctx.actor, {
    guideId: old.id,
    from: 'vencida',
    to: 'substituida',
    reason: 'recálculo',
  });
  await revokeItemLinks(tx, old.id);
  await cancelQueuedDeliveries(tx, old.id);
  return commitSerproGuide(tx, ctx, deps, company, old.period, prepared, old.id);
}

async function findWatchFor(tx: TenantTx, guide: Guide) {
  if (guide.type !== 'das_mei' && guide.type !== 'das_simples' && guide.type !== 'dctfweb')
    return null;
  return findWatch(tx, guide.companyId, guide.type, guide.period);
}

async function retryOrManual(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  guide: Guide,
  input: { guideId: string; requestedBy: 'cliente' | 'escritorio'; attempt: number },
  error: SerproError,
): Promise<RecalcOutcome> {
  if (error.temporary && input.attempt < 3) {
    await enqueue(
      deps.boss,
      ctx,
      tx,
      'serpro.recalc',
      { ...input, attempt: input.attempt + 1 },
      { startAfterSeconds: RECALC_RETRY_SECONDS, retryLimit: 0 },
    );
    return 'tentar_de_novo';
  }
  return manualRequest(tx, ctx, guide, describeError(error));
}

/** Depois de 3 tentativas (ou sem conexão), o recálculo vira pedido para o escritório. */
async function manualRequest(
  tx: TenantTx,
  ctx: TenantContext,
  guide: Guide,
  reason: string,
): Promise<RecalcOutcome> {
  await raiseAlert(tx, ctx.tenantId, {
    kind: 'recalculo_manual',
    message: `O cliente pediu a guia ${GUIDE_TYPE_LABEL[guide.type]} de ${formatPeriod(guide.period)} atualizada, mas a Receita não gerou (${reason}). Gere manualmente e envie.`,
    resourceType: 'guide',
    resourceId: guide.id,
  });
  return 'pedido_manual';
}

// ---------------------------------------------------------------------------
// serpro.connect
// ---------------------------------------------------------------------------

export async function runSerproConnect(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connectionId: string,
): Promise<'ativa' | 'erro'> {
  const now = nowOf(deps);
  const connection = await findFiscalConnection(tx);
  if (!connection || connection.id !== connectionId) return 'erro';
  // O token do procurador é refeito a partir do termo novo.
  if (connection.mode === 'plataforma') connection.procuradorTokenExpiresAt = null;
  const token = await ensureProcuradorToken(tx, ctx, deps, connection);
  let failure: SerproError | null = token.ok ? null : token.error;
  if (!failure && connection.mode === 'proprio' && deps.serpro.ambiente === 'producao') {
    // Testa a autenticação com o contrato e o e-CNPJ do escritório.
    const s = await serviceContextFor(tx, ctx, deps, connection, connection.officeCnpj);
    try {
      await s.transport.ping?.();
    } catch (error) {
      if (!(error instanceof SerproError)) throw error;
      failure = error;
    }
  }
  await updateFiscalConnection(tx, connection.id, {
    status: failure ? 'erro' : 'ativa',
    statusReason: failure ? describeError(failure) : null,
    lastCheckedAt: now,
    breakerFailures: 0,
    breakerFirstFailureAt: null,
    breakerOpenUntil: null,
  });
  await recordAudit(tx, ctx, {
    action: failure ? 'receita.conexao_falhou' : 'receita.conectada',
    resourceType: 'fiscal_connection',
    resourceId: connection.id,
    metadata: { modo: connection.mode, ambiente: deps.serpro.ambiente },
  });
  if (!failure) {
    // Primeira rotina logo em seguida, sem esperar o próximo despacho.
    await enqueue(
      deps.boss,
      ctx,
      tx,
      'serpro.tenant',
      {},
      { singletonKey: `serpro:${ctx.tenantId}` },
    );
  }
  return failure ? 'erro' : 'ativa';
}
