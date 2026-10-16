/**
 * Base das chamadas à Serpro (incremento 4), só no worker:
 * - monta quem é quem pelo modo da conexão (P1) e decifra os segredos só em memória;
 * - registra cada chamada em fiscal_calls, com custo por escritório e idempotência;
 * - aplica o disjuntor por escritório e avisa o escritório quando algo precisa dele.
 *
 * Os jobs rodam numa transação: um erro da Serpro não é relançado (desfaria o registro do
 * custo). A rotina guarda o motivo e agenda a próxima tentativa.
 */
import type { Cipher } from '@contab/adapters/crypto';
import {
  sendAuthorizationTerm,
  SerproError,
  type ProductionCredentials,
  type SerproAmbiente,
  type SerproParties,
  type SerproTransport,
  type ServiceContext,
} from '@contab/adapters/serpro';
import {
  finishFiscalCall,
  getFiscalCredentials,
  raiseAlert,
  startFiscalCall,
  updateFiscalConnection,
  upsertFiscalCredential,
  type FiscalCall,
  type FiscalCallInput,
  type FiscalConnection,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import {
  breakerAfterFailure,
  breakerIsOpen,
  SERPRO_PRICE_CENTS,
  type SerproCallKind,
} from '@contab/domain';
import { nowOf, type DeliveryDeps } from '../delivery-deps';

/** Como a plataforma fala com a Serpro (montado pelo worker a partir do ambiente). */
export type SerproPlatform = {
  ambiente: SerproAmbiente;
  /** CNPJ do contrato da plataforma (modo plataforma). */
  contratanteCnpj: string;
  /** Transporte do modo plataforma (contrato do Pedro). */
  platformTransport: SerproTransport;
  /** Transporte do modo próprio, com o contrato e o e-CNPJ do escritório. */
  ownTransport(load: () => Promise<ProductionCredentials>): SerproTransport;
};

export type FiscalDeps = DeliveryDeps & { serpro: SerproPlatform };

const decoder = new TextDecoder();

async function decrypt(cipher: Cipher, envelope: string | undefined, tenantId: string) {
  if (!envelope) return null;
  return cipher.decrypt(envelope, tenantId);
}

/** Termo de autorização com token vencido (ou sem token) precisa ser reenviado. */
function procuradorTokenUsable(connection: FiscalConnection, now: Date): boolean {
  return !!connection.procuradorTokenExpiresAt && connection.procuradorTokenExpiresAt > now;
}

/**
 * Contexto de serviço para um contribuinte. O CNPJ do contribuinte é sempre o da empresa
 * do tenant (lida pelo chamador), nunca um valor vindo de fora.
 */
export async function serviceContextFor(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
  contribuinte: string,
): Promise<ServiceContext> {
  const parties: SerproParties = {
    contratante:
      connection.mode === 'plataforma' ? deps.serpro.contratanteCnpj : connection.officeCnpj,
    autor: connection.officeCnpj,
    contribuinte,
  };
  if (connection.mode === 'proprio') {
    const transport = deps.serpro.ownTransport(async () => {
      const secrets = await getFiscalCredentials(tx, connection.id);
      const [key, secret, pfx, password] = await Promise.all([
        decrypt(deps.cipher, secrets.serpro_consumer_key, ctx.tenantId),
        decrypt(deps.cipher, secrets.serpro_consumer_secret, ctx.tenantId),
        decrypt(deps.cipher, secrets.serpro_certificado, ctx.tenantId),
        decrypt(deps.cipher, secrets.serpro_certificado_senha, ctx.tenantId),
      ]);
      if (!key || !secret || !pfx || !password)
        throw new SerproError('credencial', false, null, 'credenciais_incompletas');
      return {
        consumerKey: decoder.decode(key),
        consumerSecret: decoder.decode(secret),
        certificate: { pfx, passphrase: decoder.decode(password) },
      };
    });
    return { transport, parties };
  }
  // Modo plataforma: o token do procurador vem do termo assinado pelo escritório.
  const secrets = await getFiscalCredentials(tx, connection.id);
  const token = await decrypt(deps.cipher, secrets.serpro_procurador_token, ctx.tenantId);
  return {
    transport: deps.serpro.platformTransport,
    parties,
    procuradorToken: token ? decoder.decode(token) : null,
  };
}

export type CallMeta = Omit<FiscalCallInput, 'ambiente' | 'kind'> & { kind: SerproCallKind };

export type CallOutcome<T> =
  | { ok: true; value: T; call: FiscalCall }
  | { ok: false; error: SerproError; call: FiscalCall | null }
  | { ok: false; done: FiscalCall }
  | { ok: false; busy: true };

const ALERT_FOR: Partial<Record<SerproError['kind'], { kind: string; message: string }>> = {
  credencial: {
    kind: 'serpro_credencial',
    message:
      'A Receita Federal recusou as credenciais da conexão. Confira em Conexões › Receita Federal.',
  },
  procuracao: {
    kind: 'serpro_procuracao',
    message:
      'Falta procuração eletrônica no e-CAC desta empresa para o CNPJ do escritório. Sem ela, a guia não sai sozinha.',
  },
};

/**
 * Faz uma chamada registrada. Erro da Serpro volta como resultado (não lança): o custo, o
 * disjuntor e os alertas ficam gravados na transação do job.
 */
export async function serproCall<T>(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
  meta: CallMeta,
  run: () => Promise<T>,
): Promise<CallOutcome<T>> {
  const now = nowOf(deps);
  if (breakerIsOpen({ openUntil: connection.breakerOpenUntil }, now))
    return {
      ok: false,
      error: new SerproError('indisponivel', true, null, 'disjuntor'),
      call: null,
    };
  const started = await startFiscalCall(
    tx,
    ctx.tenantId,
    { ...meta, ambiente: deps.serpro.ambiente },
    now,
  );
  if ('done' in started) return { ok: false, done: started.done };
  if ('busy' in started) return { ok: false, busy: true };
  const t0 = Date.now();
  try {
    const value = await run();
    await finishFiscalCall(tx, started.call.id, {
      status: 'sucesso',
      httpStatus: 200,
      // Só a produção cobra; trial e gravado ficam com custo zero.
      costCents: deps.serpro.ambiente === 'producao' ? SERPRO_PRICE_CENTS[meta.kind] : 0,
      durationMs: Date.now() - t0,
    });
    if (connection.breakerFailures > 0) {
      await updateFiscalConnection(tx, connection.id, {
        breakerFailures: 0,
        breakerFirstFailureAt: null,
      });
      connection.breakerFailures = 0;
    }
    return { ok: true, value, call: started.call };
  } catch (error) {
    if (!(error instanceof SerproError)) throw error;
    await finishFiscalCall(tx, started.call.id, {
      status: 'falhou',
      httpStatus: error.httpStatus,
      errorKind: error.kind,
      errorCode: error.code,
      durationMs: Date.now() - t0,
    });
    await afterFailure(tx, ctx, deps, connection, error, meta.companyId);
    return { ok: false, error, call: started.call };
  }
}

async function afterFailure(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
  error: SerproError,
  companyId: string | null,
): Promise<void> {
  const now = nowOf(deps);
  if (error.temporary) {
    const next = breakerAfterFailure(
      {
        failures: connection.breakerFailures,
        firstFailureAt: connection.breakerFirstFailureAt,
        openUntil: connection.breakerOpenUntil,
      },
      now,
    );
    const opened =
      breakerIsOpen(next, now) && !breakerIsOpen({ openUntil: connection.breakerOpenUntil }, now);
    Object.assign(connection, {
      breakerFailures: next.failures,
      breakerFirstFailureAt: next.firstFailureAt,
      breakerOpenUntil: next.openUntil,
    });
    await updateFiscalConnection(tx, connection.id, {
      breakerFailures: next.failures,
      breakerFirstFailureAt: next.firstFailureAt,
      breakerOpenUntil: next.openUntil,
    });
    if (opened)
      await raiseAlert(tx, ctx.tenantId, {
        kind: 'serpro_pausada',
        message:
          'A Receita Federal não está respondendo. As consultas foram pausadas por 15 minutos e voltam sozinhas.',
      });
    return;
  }
  if (error.kind === 'credencial') {
    await updateFiscalConnection(tx, connection.id, {
      status: 'erro',
      statusReason: 'Credenciais recusadas pela Serpro.',
    });
    connection.status = 'erro';
  }
  const alert = ALERT_FOR[error.kind];
  if (alert)
    await raiseAlert(tx, ctx.tenantId, {
      ...alert,
      ...(error.kind === 'procuracao' && companyId
        ? { resourceType: 'client_company', resourceId: companyId }
        : {}),
    });
}

/**
 * Garante o token do procurador (modo plataforma em produção): reenvia o termo assinado
 * quando o token falta ou venceu. No trial e no gravado, o termo não gera token.
 */
export async function ensureProcuradorToken(
  tx: TenantTx,
  ctx: TenantContext,
  deps: FiscalDeps,
  connection: FiscalConnection,
): Promise<{ ok: true } | { ok: false; error: SerproError }> {
  if (connection.mode !== 'plataforma' || deps.serpro.ambiente !== 'producao') return { ok: true };
  if (procuradorTokenUsable(connection, nowOf(deps))) return { ok: true };
  const secrets = await getFiscalCredentials(tx, connection.id);
  const xml = await decrypt(deps.cipher, secrets.serpro_termo_xml, ctx.tenantId);
  if (!xml) return { ok: false, error: new SerproError('credencial', false, null, 'sem_termo') };
  const outcome = await serproCall(
    tx,
    ctx,
    deps,
    connection,
    {
      companyId: null,
      system: 'AUTENTICAPROCURADOR',
      service: 'ENVIOXMLASSINADO81',
      kind: 'apoio',
      purpose: 'conexao',
    },
    () =>
      sendAuthorizationTerm(
        {
          transport: deps.serpro.platformTransport,
          parties: {
            contratante: deps.serpro.contratanteCnpj,
            autor: connection.officeCnpj,
            contribuinte: connection.officeCnpj,
          },
        },
        decoder.decode(xml),
      ),
  );
  if (!outcome.ok) {
    return 'error' in outcome
      ? { ok: false, error: outcome.error }
      : { ok: false, error: new SerproError('indisponivel', true, null, 'ocupado') };
  }
  // Só a produção devolve token; fora dela o termo não gera nada para guardar.
  if (outcome.value.token)
    await upsertFiscalCredential(
      tx,
      ctx.tenantId,
      connection.id,
      'serpro_procurador_token',
      await deps.cipher.encrypt(new TextEncoder().encode(outcome.value.token), ctx.tenantId),
    );
  const expiresAt = outcome.value.expiresAt ?? new Date(nowOf(deps).getTime() + 24 * 3_600_000);
  await updateFiscalConnection(tx, connection.id, { procuradorTokenExpiresAt: expiresAt });
  connection.procuradorTokenExpiresAt = expiresAt;
  return { ok: true };
}
