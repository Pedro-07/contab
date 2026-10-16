/**
 * Conexão com a Receita, chamadas à Serpro e rotina fiscal (incremento 4).
 */
import type { FiscalWatchKind, FiscalWatchStatus, SerproCallKind, TenantId } from '@contab/domain';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  sum,
} from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import {
  clientCompanies,
  fiscalCalls,
  fiscalConnections,
  fiscalCredentials,
  fiscalWatches,
  guides,
} from '../schema';
import type { TenantTx } from '../tenant';

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

export type FiscalConnection = typeof fiscalConnections.$inferSelect;
export type FiscalCredentialKind = (typeof fiscalCredentials.$inferSelect)['kind'];

const activeConnection = isNull(fiscalConnections.deletedAt);

export async function findFiscalConnection(tx: TenantTx): Promise<FiscalConnection | null> {
  const [row] = await tx.select().from(fiscalConnections).where(activeConnection).limit(1);
  return row ?? null;
}

export async function insertFiscalConnection(
  tx: TenantTx,
  tenantId: TenantId,
  input: Pick<FiscalConnection, 'mode' | 'officeCnpj'>,
): Promise<FiscalConnection> {
  const [row] = await tx
    .insert(fiscalConnections)
    .values({ tenantId, id: uuidv7(), ...input })
    .returning();
  return row!;
}

export async function updateFiscalConnection(
  tx: TenantTx,
  connectionId: string,
  patch: Partial<Omit<FiscalConnection, 'tenantId' | 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<FiscalConnection> {
  const [row] = await tx
    .update(fiscalConnections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(fiscalConnections.id, connectionId))
    .returning();
  if (!row) throw new NotFoundError('fiscal_connection', connectionId);
  return row;
}

export async function upsertFiscalCredential(
  tx: TenantTx,
  tenantId: TenantId,
  connectionId: string,
  kind: FiscalCredentialKind,
  ciphertext: string,
): Promise<void> {
  await tx
    .insert(fiscalCredentials)
    .values({ tenantId, id: uuidv7(), connectionId, kind, ciphertext })
    .onConflictDoUpdate({
      target: [fiscalCredentials.tenantId, fiscalCredentials.connectionId, fiscalCredentials.kind],
      set: { ciphertext, rotatedAt: new Date() },
    });
}

/** Segredos cifrados da conexão, por tipo. */
export async function getFiscalCredentials(
  tx: TenantTx,
  connectionId: string,
): Promise<Partial<Record<FiscalCredentialKind, string>>> {
  const rows = await tx
    .select({ kind: fiscalCredentials.kind, ciphertext: fiscalCredentials.ciphertext })
    .from(fiscalCredentials)
    .where(eq(fiscalCredentials.connectionId, connectionId));
  return Object.fromEntries(rows.map((r) => [r.kind, r.ciphertext]));
}

// ---------------------------------------------------------------------------
// Chamadas (custo e idempotência)
// ---------------------------------------------------------------------------

export type FiscalCall = typeof fiscalCalls.$inferSelect;

export type FiscalCallInput = {
  companyId: string | null;
  guideId?: string | null;
  system: string;
  service: string;
  kind: SerproCallKind;
  purpose: 'rotina' | 'recalculo' | 'buscar_agora' | 'pagamento' | 'conexao';
  ambiente: string;
  idempotencyKey?: string | null;
};

/**
 * Registra o início de uma chamada. Com chave de idempotência, só uma chamada por chave
 * segue: se já existe e deu certo, devolve `{ done }`; se outra está em andamento há menos
 * de 2 minutos, devolve `{ busy }`; se falhou (ou travou), reabre a mesma linha.
 */
export async function startFiscalCall(
  tx: TenantTx,
  tenantId: TenantId,
  input: FiscalCallInput,
  now = new Date(),
): Promise<{ call: FiscalCall } | { done: FiscalCall } | { busy: true }> {
  if (!input.idempotencyKey) {
    const [row] = await tx
      .insert(fiscalCalls)
      .values({ tenantId, id: uuidv7(), ...input, createdAt: now })
      .returning();
    return { call: row! };
  }
  const [inserted] = await tx
    .insert(fiscalCalls)
    .values({ tenantId, id: uuidv7(), ...input, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { call: inserted };
  const [existing] = await tx
    .select()
    .from(fiscalCalls)
    .where(eq(fiscalCalls.idempotencyKey, input.idempotencyKey))
    .for('update');
  if (!existing) return { busy: true };
  if (existing.status === 'sucesso') return { done: existing };
  const stale = now.getTime() - (existing.finishedAt ?? existing.createdAt).getTime() > 120_000;
  if (existing.status === 'em_andamento' && !stale) return { busy: true };
  const [reopened] = await tx
    .update(fiscalCalls)
    .set({
      status: 'em_andamento',
      attempts: sql`${fiscalCalls.attempts} + 1`,
      errorKind: null,
      errorCode: null,
      finishedAt: null,
      createdAt: now,
    })
    .where(eq(fiscalCalls.id, existing.id))
    .returning();
  return { call: reopened! };
}

export async function finishFiscalCall(
  tx: TenantTx,
  callId: string,
  result: Pick<FiscalCall, 'status'> &
    Partial<
      Pick<
        FiscalCall,
        'httpStatus' | 'errorKind' | 'errorCode' | 'costCents' | 'durationMs' | 'guideId'
      >
    >,
): Promise<void> {
  await tx
    .update(fiscalCalls)
    .set({
      ...result,
      // Cada tentativa que chegou à Serpro é cobrada: soma ao custo anterior da linha.
      costCents: sql`${fiscalCalls.costCents} + ${result.costCents ?? 0}`,
      finishedAt: new Date(),
    })
    .where(eq(fiscalCalls.id, callId));
}

/** Recálculos de uma guia desde o instante dado (RN2: 3 por dia). */
export async function countRecalcsSince(
  tx: TenantTx,
  guideId: string,
  since: Date,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(fiscalCalls)
    .where(
      and(
        eq(fiscalCalls.guideId, guideId),
        eq(fiscalCalls.purpose, 'recalculo'),
        gte(fiscalCalls.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** Consumo do período: número de chamadas e custo (Conexões › Receita Federal). */
export async function fiscalUsageSince(
  tx: TenantTx,
  since: Date,
): Promise<{ calls: number; costCents: number }> {
  const [row] = await tx
    .select({ n: count(), cost: sum(fiscalCalls.costCents) })
    .from(fiscalCalls)
    .where(and(gte(fiscalCalls.createdAt, since), isNotNull(fiscalCalls.finishedAt)));
  return { calls: row?.n ?? 0, costCents: Number(row?.cost ?? 0) };
}

export async function listRecentFiscalCalls(tx: TenantTx, companyId: string, limit = 10) {
  return tx
    .select()
    .from(fiscalCalls)
    .where(eq(fiscalCalls.companyId, companyId))
    .orderBy(desc(fiscalCalls.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Rotina do mês
// ---------------------------------------------------------------------------

export type FiscalWatch = typeof fiscalWatches.$inferSelect;

/** Cria a rotina da empresa no mês, se ainda não existe. */
export async function ensureWatch(
  tx: TenantTx,
  tenantId: TenantId,
  input: { companyId: string; kind: FiscalWatchKind; period: string; nextCheckAt: Date },
): Promise<FiscalWatch | null> {
  const [row] = await tx
    .insert(fiscalWatches)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function getWatch(tx: TenantTx, watchId: string): Promise<FiscalWatch> {
  const [row] = await tx.select().from(fiscalWatches).where(eq(fiscalWatches.id, watchId));
  if (!row) throw new NotFoundError('fiscal_watch', watchId);
  return row;
}

export async function findWatch(
  tx: TenantTx,
  companyId: string,
  kind: FiscalWatchKind,
  period: string,
): Promise<FiscalWatch | null> {
  const [row] = await tx
    .select()
    .from(fiscalWatches)
    .where(
      and(
        eq(fiscalWatches.companyId, companyId),
        eq(fiscalWatches.kind, kind),
        eq(fiscalWatches.period, period),
      ),
    );
  return row ?? null;
}

export async function updateWatch(
  tx: TenantTx,
  watchId: string,
  patch: Partial<
    Pick<
      FiscalWatch,
      'status' | 'nextCheckAt' | 'guideId' | 'lastError' | 'lastCheckedAt' | 'checks'
    >
  >,
): Promise<void> {
  await tx
    .update(fiscalWatches)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(fiscalWatches.id, watchId));
}

/** Rotinas com consulta vencida, das empresas ativas. */
export async function listDueWatches(tx: TenantTx, now: Date, limit = 100): Promise<FiscalWatch[]> {
  const rows = await tx
    .select({ watch: fiscalWatches })
    .from(fiscalWatches)
    .innerJoin(
      clientCompanies,
      and(
        eq(clientCompanies.tenantId, fiscalWatches.tenantId),
        eq(clientCompanies.id, fiscalWatches.companyId),
      ),
    )
    .where(
      and(
        inArray(fiscalWatches.status, ['aguardando', 'gerada'] satisfies FiscalWatchStatus[]),
        lte(fiscalWatches.nextCheckAt, now),
        eq(clientCompanies.status, 'ativa'),
        isNull(clientCompanies.deletedAt),
      ),
    )
    .orderBy(asc(fiscalWatches.nextCheckAt))
    .limit(limit);
  return rows.map((r) => r.watch);
}

export async function listCompanyWatches(tx: TenantTx, companyId: string, limit = 6) {
  return tx
    .select()
    .from(fiscalWatches)
    .where(eq(fiscalWatches.companyId, companyId))
    .orderBy(desc(fiscalWatches.period))
    .limit(limit);
}

/** Empresas ativas que a rotina acompanha (todas, no MVP; cada uma pelo regime). */
export async function listActiveCompaniesForRoutine(tx: TenantTx) {
  return tx
    .select({
      id: clientCompanies.id,
      cnpj: clientCompanies.cnpj,
      regime: clientCompanies.regime,
    })
    .from(clientCompanies)
    .where(and(eq(clientCompanies.status, 'ativa'), isNull(clientCompanies.deletedAt)));
}

// ---------------------------------------------------------------------------
// Guias da Serpro
// ---------------------------------------------------------------------------

/** Números de documento das guias da rotina que ainda podem ser pagas (I5: inclui a substituída). */
export async function listWatchDocumentGuides(
  tx: TenantTx,
  input: { companyId: string; type: FiscalWatchKind; period: string },
) {
  return tx
    .select()
    .from(guides)
    .where(
      and(
        eq(guides.companyId, input.companyId),
        eq(guides.type, input.type),
        eq(guides.period, input.period),
        isNotNull(guides.externalNumber),
        inArray(guides.status, ['publicada', 'vencida', 'substituida']),
      ),
    );
}

export async function setGuideReceipt(
  tx: TenantTx,
  guideId: string,
  receipt: { storageKey: string; sha256: string },
): Promise<void> {
  await tx
    .update(guides)
    .set({
      receiptStorageKey: receipt.storageKey,
      receiptSha256: receipt.sha256,
      updatedAt: new Date(),
    })
    .where(eq(guides.id, guideId));
}

/** Guia ativa da empresa no tipo e competência (RN5), se houver. */
export async function findActiveGuide(
  tx: TenantTx,
  companyId: string,
  type: FiscalWatchKind,
  period: string,
) {
  const [row] = await tx
    .select()
    .from(guides)
    .where(
      and(
        eq(guides.companyId, companyId),
        eq(guides.type, type),
        eq(guides.period, period),
        inArray(guides.status, ['rascunho', 'publicada', 'vencida']),
      ),
    );
  return row ?? null;
}
