/**
 * Conexões › Receita Federal (P1) e pedidos à rotina fiscal (incremento 4). Aqui só se
 * grava e enfileira: quem fala com a Serpro é o worker (`@contab/core/serpro-worker`).
 *
 * - plataforma: o escritório envia o termo de autorização assinado no computador dele
 *   (Assinador do Serpro). O certificado do escritório nunca é enviado.
 * - próprio: o escritório informa o contrato dele (consumer key/secret) e o e-CNPJ dele,
 *   exceção prevista no CLAUDE.md. Tudo cifrado por envelope com o tenant (ADR 0006).
 */
import type { Cipher } from '@contab/adapters/crypto';
import {
  countRecalcsSince,
  ensureWatch,
  findFiscalConnection,
  findSecureLink,
  findWatch,
  fiscalUsageSince,
  getCompany,
  getGuide,
  getTenantSettings,
  insertFiscalConnection,
  listCompanyWatches,
  listRecentFiscalCalls,
  recordAudit,
  updateFiscalConnection,
  updateWatch,
  upsertFiscalCredential,
  withTenant,
  type FiscalConnection,
  type FiscalCredentialKind,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  canManageConnections,
  canManageGuides,
  canRecalculate,
  localDateAt,
  localParts,
  openPeriod,
  parseCnpj,
  parseIsoDate,
  watchKindForRegime,
  type TenantId,
} from '@contab/domain';
import { createSecureContext } from 'node:tls';
import type { PgBoss } from 'pg-boss';
import { ClientInputError, uuidOrNotFound } from './clients';
import { hashLinkToken } from './deliveries';
import { actorRole, deny, logNotFound } from './guard';

export type FiscalConnectDeps = { boss: PgBoss; cipher: Cipher; now?: () => Date };

const MAX_TERM_BYTES = 256 * 1024;
const MAX_CERT_BYTES = 64 * 1024;
const encoder = new TextEncoder();

async function requireConnectionManager(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageConnections(role))
    await deny(ctx, 'Seu papel não permite alterar conexões.', 'fiscal_connection');
}

async function requireViewer(ctx: TenantContext): Promise<void> {
  if (!actorRole(ctx)) await deny(ctx, 'Sem acesso.', 'fiscal_connection');
}

function officeCnpjOrError(value: string): string {
  const cnpj = parseCnpj(value);
  if (!cnpj) throw new ClientInputError('CNPJ do escritório inválido.');
  return cnpj;
}

function monthStart(now: Date, timezone: string): Date {
  const today = localParts(now, timezone).date;
  return localDateAt(`${today.slice(0, 8)}01`, 0, timezone);
}

export type FiscalConnectionView = {
  connection:
    | (Pick<
        FiscalConnection,
        'mode' | 'officeCnpj' | 'status' | 'statusReason' | 'termValidUntil' | 'lastCheckedAt'
      > & { paused: boolean })
    | null;
  usage: { calls: number; costCents: number };
};

export async function getFiscalConnectionView(ctx: TenantContext): Promise<FiscalConnectionView> {
  await requireViewer(ctx);
  return withTenant(ctx, async (tx) => {
    const connection = await findFiscalConnection(tx);
    const settings = await getTenantSettings(tx);
    const now = new Date();
    const usage = await fiscalUsageSince(
      tx,
      monthStart(now, settings?.timezone ?? 'America/Fortaleza'),
    );
    return {
      connection: connection
        ? {
            mode: connection.mode,
            officeCnpj: connection.officeCnpj,
            status: connection.status,
            statusReason: connection.statusReason,
            termValidUntil: connection.termValidUntil,
            lastCheckedAt: connection.lastCheckedAt,
            paused: !!connection.breakerOpenUntil && connection.breakerOpenUntil > now,
          }
        : null,
      usage,
    };
  });
}

/** Cria ou troca a conexão do escritório e guarda os segredos cifrados. */
async function saveConnection(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalConnectDeps,
  input: {
    mode: FiscalConnection['mode'];
    officeCnpj: string;
    termValidUntil: Date | null;
    secrets: Partial<Record<FiscalCredentialKind, Uint8Array>>;
  },
): Promise<FiscalConnection> {
  const existing = await findFiscalConnection(tx);
  let connection: FiscalConnection;
  if (existing && existing.mode === input.mode) {
    connection = await updateFiscalConnection(tx, existing.id, {
      officeCnpj: input.officeCnpj,
      status: 'pendente',
      statusReason: null,
      termValidUntil: input.termValidUntil,
      procuradorTokenExpiresAt: null,
    });
  } else {
    // Troca de modo: a conexão anterior sai (exclusão lógica) e os segredos dela ficam inúteis.
    if (existing)
      await updateFiscalConnection(tx, existing.id, {
        deletedAt: new Date(),
        status: 'desconectada',
      });
    connection = await insertFiscalConnection(tx, ctx.tenantId, {
      mode: input.mode,
      officeCnpj: input.officeCnpj,
    });
    if (input.termValidUntil)
      connection = await updateFiscalConnection(tx, connection.id, {
        termValidUntil: input.termValidUntil,
      });
  }
  for (const [kind, value] of Object.entries(input.secrets) as Array<
    [FiscalCredentialKind, Uint8Array]
  >) {
    await upsertFiscalCredential(
      tx,
      ctx.tenantId,
      connection.id,
      kind,
      await deps.cipher.encrypt(value, ctx.tenantId),
    );
  }
  await enqueue(deps.boss, ctx, tx, 'serpro.connect', { connectionId: connection.id });
  await recordAudit(tx, ctx, {
    action: 'receita.conexao_salva',
    resourceType: 'fiscal_connection',
    resourceId: connection.id,
    metadata: { modo: input.mode },
  });
  return connection;
}

/**
 * Modo plataforma: CNPJ do escritório e o XML do termo de autorização já assinado.
 * Só confere o formato; a Serpro confere a assinatura quando o worker envia.
 */
export async function connectFiscalPlatform(
  ctx: TenantContext,
  deps: FiscalConnectDeps,
  input: { officeCnpj: string; termXml: string; termValidUntil: string },
): Promise<void> {
  await requireConnectionManager(ctx);
  const officeCnpj = officeCnpjOrError(input.officeCnpj);
  const xml = input.termXml.trim();
  if (!xml) throw new ClientInputError('Envie o termo de autorização assinado (arquivo XML).');
  if (encoder.encode(xml).length > MAX_TERM_BYTES)
    throw new ClientInputError('O arquivo do termo passa de 256 KB.');
  if (!xml.startsWith('<') || !/<(\w+:)?Signature[\s>]/.test(xml))
    throw new ClientInputError('O arquivo não parece um termo assinado (XML com assinatura).');
  const validUntil = parseIsoDate(input.termValidUntil);
  if (!validUntil) throw new ClientInputError('Informe até quando o termo vale.');
  const until = new Date(`${validUntil}T23:59:59-03:00`);
  if (until <= new Date()) throw new ClientInputError('O termo informado já venceu.');
  await withTenant(ctx, (tx) =>
    saveConnection(tx, ctx, deps, {
      mode: 'plataforma',
      officeCnpj,
      termValidUntil: until,
      secrets: { serpro_termo_xml: encoder.encode(xml) },
    }),
  );
}

/** Modo próprio: contrato e e-CNPJ do escritório (exceção do CLAUDE.md). */
export async function connectFiscalOwn(
  ctx: TenantContext,
  deps: FiscalConnectDeps,
  input: {
    officeCnpj: string;
    consumerKey: string;
    consumerSecret: string;
    certificate: Uint8Array;
    certificatePassword: string;
  },
): Promise<void> {
  await requireConnectionManager(ctx);
  const officeCnpj = officeCnpjOrError(input.officeCnpj);
  const key = input.consumerKey.trim();
  const secret = input.consumerSecret.trim();
  if (key.length < 8 || key.length > 200 || secret.length < 8 || secret.length > 200)
    throw new ClientInputError('Confira a consumer key e o consumer secret do contrato.');
  if (!input.certificate.length || input.certificate.length > MAX_CERT_BYTES)
    throw new ClientInputError('Envie o e-CNPJ do escritório (arquivo .pfx ou .p12).');
  try {
    // Confere arquivo e senha aqui, sem guardar nada em claro.
    createSecureContext({
      pfx: Buffer.from(input.certificate),
      passphrase: input.certificatePassword,
    });
  } catch {
    throw new ClientInputError(
      'Não foi possível abrir o certificado. Confira o arquivo e a senha.',
    );
  }
  await withTenant(ctx, (tx) =>
    saveConnection(tx, ctx, deps, {
      mode: 'proprio',
      officeCnpj,
      termValidUntil: null,
      secrets: {
        serpro_consumer_key: encoder.encode(key),
        serpro_consumer_secret: encoder.encode(secret),
        serpro_certificado: input.certificate,
        serpro_certificado_senha: encoder.encode(input.certificatePassword),
      },
    }),
  );
}

/** Testar conexão: o worker refaz a autenticação (ou o envio do termo). */
export async function testFiscalConnection(ctx: TenantContext, boss: PgBoss): Promise<void> {
  await requireConnectionManager(ctx);
  await withTenant(ctx, async (tx) => {
    const connection = await findFiscalConnection(tx);
    if (!connection) throw new ClientInputError('Conecte a Receita Federal primeiro.');
    await enqueue(boss, ctx, tx, 'serpro.connect', { connectionId: connection.id });
  });
}

export async function disconnectFiscal(ctx: TenantContext): Promise<void> {
  await requireConnectionManager(ctx);
  await withTenant(ctx, async (tx) => {
    const connection = await findFiscalConnection(tx);
    if (!connection) return;
    await updateFiscalConnection(tx, connection.id, {
      status: 'desconectada',
      deletedAt: new Date(),
    });
    await recordAudit(tx, ctx, {
      action: 'receita.desconectada',
      resourceType: 'fiscal_connection',
      resourceId: connection.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Ficha da empresa: situação da rotina e "Buscar agora"
// ---------------------------------------------------------------------------

export async function getCompanyFiscalStatus(ctx: TenantContext, companyId: string) {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const connection = await findFiscalConnection(tx);
      return {
        connected: connection?.status === 'ativa',
        watches: await listCompanyWatches(tx, company.id),
        calls: await listRecentFiscalCalls(tx, company.id, 5),
      };
    }),
  );
}

/** Intervalo mínimo entre dois "Buscar agora" da mesma empresa (cada consulta custa). */
const CHECK_NOW_COOLDOWN_MS = 10 * 60_000;

export async function requestFiscalCheckNow(
  ctx: TenantContext,
  boss: PgBoss,
  companyId: string,
): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageGuides(role))
    await deny(ctx, 'Seu papel não permite consultar a Receita.', 'fiscal_watch');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      if (company.status !== 'ativa') throw new ClientInputError('A empresa está inativa.');
      const connection = await findFiscalConnection(tx);
      if (connection?.status !== 'ativa')
        throw new ClientInputError('Conecte a Receita Federal em Conexões antes de consultar.');
      const settings = await getTenantSettings(tx);
      const now = new Date();
      const period = openPeriod(localParts(now, settings?.timezone ?? 'America/Fortaleza').date);
      const kind = watchKindForRegime(company.regime);
      await ensureWatch(tx, ctx.tenantId, {
        companyId: company.id,
        kind,
        period,
        nextCheckAt: now,
      });
      const watch = (await findWatch(tx, company.id, kind, period))!;
      if (watch.status !== 'aguardando' && watch.status !== 'gerada')
        throw new ClientInputError('A rotina deste mês já terminou para esta empresa.');
      if (
        watch.lastCheckedAt &&
        now.getTime() - watch.lastCheckedAt.getTime() < CHECK_NOW_COOLDOWN_MS
      )
        throw new ClientInputError('Consultamos há poucos minutos. Tente de novo daqui a pouco.');
      await updateWatch(tx, watch.id, { lastCheckedAt: now });
      await enqueue(
        boss,
        ctx,
        tx,
        'serpro.watch',
        { watchId: watch.id, trigger: 'buscar_agora' },
        { singletonKey: `serpro.watch:${watch.id}`, retryLimit: 0 },
      );
      await recordAudit(tx, ctx, {
        action: 'receita.buscar_agora',
        resourceType: 'client_company',
        resourceId: company.id,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Recálculo (RN2, CA2)
// ---------------------------------------------------------------------------

async function recalcAllowed(tx: TenantTx, guideId: string, timezone: string) {
  const guide = await getGuide(tx, guideId);
  const today = localParts(new Date(), timezone).date;
  const used = await countRecalcsSince(tx, guide.id, localDateAt(today, 0, timezone));
  return { guide, check: canRecalculate(guide, used) };
}

const RECALC_DENIED = {
  tipo: 'Esta guia não é recalculada pela Receita.',
  status: 'Só dá para atualizar guia vencida e não paga.',
  sem_numero: 'Esta guia não veio da Receita; gere a atualizada manualmente.',
  limite: 'Esta guia já foi atualizada 3 vezes hoje.',
} as const;

/** O escritório pede o recálculo pela ficha da guia. */
export async function requestRecalcByStaff(
  ctx: TenantContext,
  boss: PgBoss,
  guideId: string,
): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageGuides(role))
    await deny(ctx, 'Seu papel não permite atualizar guias.', 'guide');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const settings = await getTenantSettings(tx);
      const { guide, check } = await recalcAllowed(
        tx,
        uuidOrNotFound(guideId, 'guide'),
        settings?.timezone ?? 'America/Fortaleza',
      );
      if (!check.ok) throw new ClientInputError(RECALC_DENIED[check.reason]);
      await enqueueRecalc(boss, ctx, tx, guide.id, 'escritorio');
      await recordAudit(tx, ctx, {
        action: 'guia.recalculo_pedido',
        resourceType: 'guide',
        resourceId: guide.id,
      });
    }),
  );
}

async function enqueueRecalc(
  boss: PgBoss,
  ctx: TenantContext,
  tx: TenantTx,
  guideId: string,
  requestedBy: 'cliente' | 'escritorio',
) {
  await enqueue(
    boss,
    ctx,
    tx,
    'serpro.recalc',
    { guideId, requestedBy, attempt: 1 },
    { singletonKey: `serpro.recalc:${guideId}`, retryLimit: 0 },
  );
}

export type LinkRecalcResult = 'pedido' | 'indisponivel' | 'limite';

/**
 * O cliente toca "Atualizar guia" no link seguro (CA2). O tenant vem do subdomínio e a
 * guia, do token; nada do navegador escolhe tenant ou guia.
 */
export async function requestRecalcByLink(
  tenantId: TenantId,
  token: string,
  boss: PgBoss,
  meta: { requestId: string; ip?: string | null },
): Promise<LinkRecalcResult> {
  const ctx: TenantContext = {
    tenantId,
    actor: { type: 'system', jobName: 'portal.recalc', jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
  return withTenant(ctx, async (tx) => {
    const link = await findSecureLink(tx, hashLinkToken(token));
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return 'indisponivel';
    const settings = await getTenantSettings(tx);
    const { guide, check } = await recalcAllowed(
      tx,
      link.itemId,
      settings?.timezone ?? 'America/Fortaleza',
    );
    if (!check.ok) return check.reason === 'limite' ? 'limite' : 'indisponivel';
    await enqueueRecalc(boss, ctx, tx, guide.id, 'cliente');
    await recordAudit(tx, ctx, {
      action: 'guia.recalculo_pedido',
      resourceType: 'guide',
      resourceId: guide.id,
      metadata: { pedido_por: 'cliente' },
    });
    return 'pedido';
  });
}
