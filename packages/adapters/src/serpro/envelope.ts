/**
 * Envelope do Integra Contador: tipos, corpo da chamada, leitura da resposta e erros.
 */
import { z } from 'zod';

export type SerproEndpoint = 'Apoiar' | 'Consultar' | 'Declarar' | 'Emitir' | 'Monitorar';
export type SerproAmbiente = 'fake' | 'trial' | 'producao';

/** Quem é quem na chamada (seção 2 do plano do incremento). */
export type SerproParties = {
  /** CNPJ do contrato: o da plataforma (modo plataforma) ou o do escritório (modo próprio). */
  contratante: string;
  /** CNPJ do escritório, procurador do cliente. */
  autor: string;
  /** CNPJ do cliente. Sempre vem da empresa do tenant, nunca do pedido. */
  contribuinte: string;
};

export type SerproRequest = {
  endpoint: SerproEndpoint;
  system: string;
  service: string;
  version: string;
  parties: SerproParties;
  dados: Record<string, unknown>;
  /** Token do termo de autorização (modo plataforma). */
  procuradorToken?: string | null;
};

export type SerproMessage = { codigo: string; texto: string };

/** Envelope de resposta: `dados` é texto JSON. */
export type SerproEnvelope = { status: number; mensagens: SerproMessage[]; dados: string | null };

export interface SerproTransport {
  readonly ambiente: SerproAmbiente;
  send(request: SerproRequest): Promise<SerproEnvelope>;
  /** Só autentica (teste de conexão do modo próprio). */
  ping?(): Promise<void>;
}

export type SerproErrorKind =
  'limite' | 'indisponivel' | 'credencial' | 'procuracao' | 'nao_encontrado' | 'dados' | 'resposta';

/** Erro da Serpro. `temporary`: vale tentar de novo mais tarde (e conta no disjuntor). */
export class SerproError extends Error {
  constructor(
    readonly kind: SerproErrorKind,
    readonly temporary: boolean,
    readonly httpStatus: number | null,
    readonly code: string | null = null,
  ) {
    super(`Serpro: ${kind}${code ? ` (${code})` : ''}`);
    this.name = 'SerproError';
  }
}

export const TIMEOUT_MS = 15_000;

const envelopeSchema = z.object({
  status: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  mensagens: z
    .array(z.object({ codigo: z.string().catch(''), texto: z.string().catch('') }))
    .nullish()
    .transform((v) => v ?? []),
  dados: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

/** Lê o corpo HTTP e classifica os erros do gateway e do envelope. */
export function parseEnvelope(httpStatus: number, body: string): SerproEnvelope {
  if (httpStatus === 429) throw new SerproError('limite', true, 429, codeOf(body));
  if (httpStatus === 401 || httpStatus === 403)
    throw new SerproError('credencial', false, httpStatus, codeOf(body));
  if (httpStatus >= 500 || httpStatus === 408)
    throw new SerproError('indisponivel', true, httpStatus);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new SerproError('resposta', false, httpStatus);
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) throw new SerproError('resposta', false, httpStatus);
  const envelope = parsed.data;
  return checkEnvelope(envelope, httpStatus);
}

/** Envelope de sucesso passa; o resto vira SerproError. 204 é "nada encontrado". */
export function checkEnvelope(envelope: SerproEnvelope, httpStatus = 200): SerproEnvelope {
  if (envelope.status >= 200 && envelope.status < 300 && envelope.status !== 204) return envelope;
  throw classifyEnvelope(envelope, httpStatus);
}

function codeOf(body: string): string | null {
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * Erro dentro do envelope (HTTP 200 com status 4xx/5xx). Os códigos de negócio da Serpro
 * mudam por sistema; a classificação usa o status e o texto (a confirmar em produção).
 */
export function classifyEnvelope(envelope: SerproEnvelope, httpStatus: number): SerproError {
  const text = envelope.mensagens
    .map((m) => `${m.codigo} ${m.texto}`)
    .join(' ')
    .toLowerCase();
  const code = envelope.mensagens[0]?.codigo ?? null;
  if (envelope.status >= 500) return new SerproError('indisponivel', true, httpStatus, code);
  if (/procura[cç][aã]o|n[aã]o autorizad|sem autoriza|token.*procurador/.test(text))
    return new SerproError('procuracao', false, httpStatus, code);
  if (
    envelope.status === 204 ||
    envelope.status === 404 ||
    /n[aã]o (foi )?encontrad|inexistente|n[aã]o h[aá] |n[aã]o existe|nenhum/.test(text)
  )
    return new SerproError('nao_encontrado', false, httpStatus, code);
  return new SerproError('dados', false, httpStatus, code);
}

/** Corpo da chamada no formato do Integra Contador. */
export function requestBody(request: SerproRequest): string {
  const party = (numero: string) => ({ numero, tipo: numero.length === 11 ? 1 : 2 });
  return JSON.stringify({
    contratante: party(request.parties.contratante),
    autorPedidoDados: party(request.parties.autor),
    contribuinte: party(request.parties.contribuinte),
    pedidoDados: {
      idSistema: request.system,
      idServico: request.service,
      versaoSistema: request.version,
      dados: JSON.stringify(request.dados),
    },
  });
}

/** POST com timeout. Erro de rede vira `indisponivel` (temporário). */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: string }> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch {
    throw new SerproError('indisponivel', true, null);
  }
}
