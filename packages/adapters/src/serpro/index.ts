/**
 * Adaptador do Integra Contador da Serpro (ADR 0004, incremento 4). Chamado só pelo worker.
 *
 * Três transportes atrás da mesma interface:
 * - `producao`: autenticação com consumer key/secret e e-CNPJ do contratante em mTLS;
 *   o certificado chega decifrado por chamada e fica só em memória;
 * - `trial`: o ambiente de testes público da Serpro, que só aceita os exemplos da
 *   documentação (veja `scenarios.ts`);
 * - `fake`: as respostas gravadas do trial (`fixtures/serpro`), para testes e CI.
 *
 * Timeout, erros classificados (temporário ou não) e nenhum conteúdo de resposta em log.
 * Retentativa, disjuntor, idempotência e custo ficam no núcleo, que sabe o tenant.
 */
import { logger } from '@contab/config/logger';
import { parseSerproDate, reaisToCents, serproPeriod, type SerproCallKind } from '@contab/domain';
import { z } from 'zod';

import {
  SerproError,
  type SerproEndpoint,
  type SerproEnvelope,
  type SerproParties,
  type SerproRequest,
  type SerproTransport,
} from './envelope';

export * from './envelope';

// ---------------------------------------------------------------------------
// Serviços usados no incremento 4
// ---------------------------------------------------------------------------

/** Tipo de cada serviço, para o custo (SERPRO_PRICE_CENTS). */
export const SERVICE_KIND: Record<string, SerproCallKind> = {
  GERARDASPDF21: 'emissao',
  GERARDAS12: 'emissao',
  GERARGUIA31: 'emissao',
  COMPARRECADACAO72: 'emissao',
  CONSULTIMADECREC14: 'consulta',
  CONSRECIBO32: 'consulta',
  PAGAMENTOS71: 'consulta',
  ENVIOXMLASSINADO81: 'apoio',
};

export type DasResult = {
  cnpj: string;
  period: string;
  documentNumber: string;
  dueDate: string;
  /** "Pagar este documento até": no recálculo, a validade dos novos valores. */
  payUntil: string;
  amountCents: number;
  pdf: Uint8Array;
};

const money = z.number().nonnegative();
const dasDetail = z.object({
  periodoApuracao: z.union([z.string(), z.number()]).transform(String),
  numeroDocumento: z.string().regex(/^\d{17}$/),
  dataVencimento: z.union([z.string(), z.number()]),
  dataLimiteAcolhimento: z.union([z.string(), z.number()]).nullish(),
  valores: z.object({ total: money }),
});

function decodePdf(base64: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-')
    throw new SerproError('resposta', false, null, 'pdf_invalido');
  return bytes;
}

function parseDados<T>(envelope: SerproEnvelope, schema: z.ZodType<T>): T {
  if (!envelope.dados) throw new SerproError('resposta', false, null, 'sem_dados');
  let json: unknown;
  try {
    json = JSON.parse(envelope.dados);
  } catch {
    throw new SerproError('resposta', false, null, 'dados_invalidos');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new SerproError('resposta', false, null, 'formato_inesperado');
  return parsed.data;
}

function toDas(cnpj: string, pdfBase64: string, detail: z.infer<typeof dasDetail>): DasResult {
  const dueDate = parseSerproDate(detail.dataVencimento as string);
  const payUntil = parseSerproDate(detail.dataLimiteAcolhimento as string) ?? dueDate;
  const period = /^(\d{4})(\d{2})$/.exec(detail.periodoApuracao);
  if (!dueDate || !payUntil || !period) throw new SerproError('resposta', false, null, 'datas');
  return {
    cnpj,
    period: `${period[1]}-${period[2]}-01`,
    documentNumber: detail.numeroDocumento,
    dueDate,
    payUntil,
    amountCents: reaisToCents(detail.valores.total),
    pdf: decodePdf(pdfBase64),
  };
}

type Call = { request: SerproRequest; envelope: SerproEnvelope };

/** Executa a chamada e devolve o envelope já validado, com log sem conteúdo. */
async function call(transport: SerproTransport, request: SerproRequest): Promise<Call> {
  const started = Date.now();
  try {
    const envelope = await transport.send(request);
    logger.info(
      { serpro: request.service, ambiente: transport.ambiente, ms: Date.now() - started },
      'serpro: chamada ok',
    );
    return { request, envelope };
  } catch (error) {
    logger.warn(
      {
        serpro: request.service,
        ambiente: transport.ambiente,
        ms: Date.now() - started,
        kind: error instanceof SerproError ? error.kind : 'desconhecido',
      },
      'serpro: chamada falhou',
    );
    throw error;
  }
}

function req(
  endpoint: SerproEndpoint,
  system: string,
  service: string,
  parties: SerproParties,
  dados: Record<string, unknown>,
  procuradorToken?: string | null,
): SerproRequest {
  return {
    endpoint,
    system,
    service,
    version: '1.0',
    parties,
    dados,
    procuradorToken: procuradorToken ?? null,
  };
}

export type ServiceContext = {
  transport: SerproTransport;
  parties: SerproParties;
  procuradorToken?: string | null;
};

/** PGMEI/GERARDASPDF21: DAS do MEI com PDF. `consolidationDate` recalcula (RN2). */
export async function emitDasMei(
  s: ServiceContext,
  input: { period: string; consolidationDate?: string | null },
): Promise<DasResult> {
  const { envelope } = await call(
    s.transport,
    req(
      'Emitir',
      'PGMEI',
      'GERARDASPDF21',
      s.parties,
      {
        periodoApuracao: serproPeriod(input.period),
        ...(input.consolidationDate
          ? { dataConsolidacao: input.consolidationDate.replace(/-/g, '') }
          : {}),
      },
      s.procuradorToken,
    ),
  );
  const [item] = parseDados(
    envelope,
    z
      .array(
        z.object({
          cnpjCompleto: z.string(),
          pdf: z.string().min(8),
          detalhamento: z.array(dasDetail).min(1),
        }),
      )
      .min(1),
  );
  return toDas(item!.cnpjCompleto, item!.pdf, item!.detalhamento[0]!);
}

/** PGDASD/CONSULTIMADECREC14: a declaração do mês já foi transmitida? */
export async function findSimplesDeclaration(
  s: ServiceContext,
  period: string,
): Promise<{ declarationNumber: string } | null> {
  try {
    const { envelope } = await call(
      s.transport,
      req(
        'Consultar',
        'PGDASD',
        'CONSULTIMADECREC14',
        s.parties,
        {
          periodoApuracao: serproPeriod(period),
        },
        s.procuradorToken,
      ),
    );
    const dados = parseDados(envelope, z.object({ numeroDeclaracao: z.string().min(1) }));
    return { declarationNumber: dados.numeroDeclaracao };
  } catch (error) {
    if (error instanceof SerproError && error.kind === 'nao_encontrado') return null;
    throw error;
  }
}

/** PGDASD/GERARDAS12: DAS do Simples da declaração transmitida. */
export async function emitDasSimples(
  s: ServiceContext,
  input: { period: string; consolidationDate?: string | null },
): Promise<DasResult> {
  const { envelope } = await call(
    s.transport,
    req(
      'Emitir',
      'PGDASD',
      'GERARDAS12',
      s.parties,
      {
        periodoApuracao: serproPeriod(input.period),
        ...(input.consolidationDate
          ? { dataConsolidacao: input.consolidationDate.replace(/-/g, '') }
          : {}),
      },
      s.procuradorToken,
    ),
  );
  const [item] = parseDados(
    envelope,
    z
      .array(
        z.object({ cnpjCompleto: z.string(), pdf: z.string().min(8), detalhamentoDas: dasDetail }),
      )
      .min(1),
  );
  return toDas(item!.cnpjCompleto, item!.pdf, item!.detalhamentoDas);
}

function dctfwebPeriod(period: string) {
  return { anoPA: period.slice(0, 4), mesPA: period.slice(5, 7) };
}

/** DCTFWEB/CONSRECIBO32: recibo da declaração do mês (prova de que foi transmitida). */
export async function findDctfwebReceipt(
  s: ServiceContext,
  period: string,
): Promise<{ receiptPdf: Uint8Array } | null> {
  try {
    const { envelope } = await call(
      s.transport,
      req(
        'Consultar',
        'DCTFWEB',
        'CONSRECIBO32',
        s.parties,
        {
          categoria: 40,
          ...dctfwebPeriod(period),
        },
        s.procuradorToken,
      ),
    );
    const dados = parseDados(envelope, z.object({ PDFByteArrayBase64: z.string().min(8) }));
    return { receiptPdf: decodePdf(dados.PDFByteArrayBase64) };
  } catch (error) {
    if (error instanceof SerproError && error.kind === 'nao_encontrado') return null;
    throw error;
  }
}

/** DCTFWEB/GERARGUIA31: só o PDF da guia; valor, vencimento e número saem do PDF (S3). */
export async function emitDctfwebGuide(s: ServiceContext, period: string): Promise<Uint8Array> {
  const { envelope } = await call(
    s.transport,
    req(
      'Emitir',
      'DCTFWEB',
      'GERARGUIA31',
      s.parties,
      {
        categoria: 'GERAL_MENSAL',
        ...dctfwebPeriod(period),
      },
      s.procuradorToken,
    ),
  );
  const dados = parseDados(envelope, z.object({ PDFByteArrayBase64: z.string().min(8) }));
  return decodePdf(dados.PDFByteArrayBase64);
}

export type Payment = { documentNumber: string; paidOn: string; amountCents: number };

/** PAGTOWEB/PAGAMENTOS71: pagamentos dos documentos dados (só os encontrados voltam). */
export async function findPayments(
  s: ServiceContext,
  documentNumbers: string[],
): Promise<Payment[]> {
  if (!documentNumbers.length) return [];
  let envelope: SerproEnvelope;
  try {
    ({ envelope } = await call(
      s.transport,
      req(
        'Consultar',
        'PAGTOWEB',
        'PAGAMENTOS71',
        s.parties,
        {
          numeroDocumentoLista: documentNumbers,
          primeiroDaPagina: 0,
          tamanhoDaPagina: 100,
        },
        s.procuradorToken,
      ),
    ));
  } catch (error) {
    if (error instanceof SerproError && error.kind === 'nao_encontrado') return [];
    throw error;
  }
  if (!envelope.dados) return [];
  const rows = parseDados(
    envelope,
    z.array(
      z.object({
        numeroDocumento: z.string(),
        dataArrecadacao: z.string(),
        valorTotal: money.nullable(),
      }),
    ),
  );
  return rows.flatMap((r) => {
    const paidOn = r.dataArrecadacao.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return [];
    return [
      {
        documentNumber: r.numeroDocumento.replace(/\D/g, ''),
        paidOn,
        amountCents: reaisToCents(r.valorTotal ?? 0),
      },
    ];
  });
}

/** PAGTOWEB/COMPARRECADACAO72: PDF do comprovante de arrecadação. */
export async function paymentReceipt(
  s: ServiceContext,
  documentNumber: string,
): Promise<Uint8Array> {
  const { envelope } = await call(
    s.transport,
    req(
      'Emitir',
      'PAGTOWEB',
      'COMPARRECADACAO72',
      s.parties,
      { numeroDocumento: documentNumber },
      s.procuradorToken,
    ),
  );
  const dados = parseDados(envelope, z.object({ pdf: z.string().min(8) }));
  return decodePdf(dados.pdf);
}

/**
 * AUTENTICAPROCURADOR/ENVIOXMLASSINADO81: envia o termo assinado pelo escritório e recebe o
 * token do procurador (modo plataforma). Formato da resposta a confirmar em produção.
 */
export async function sendAuthorizationTerm(
  s: Omit<ServiceContext, 'procuradorToken'>,
  signedXml: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const { envelope } = await call(
    s.transport,
    req('Apoiar', 'AUTENTICAPROCURADOR', 'ENVIOXMLASSINADO81', s.parties, {
      xml: Buffer.from(signedXml, 'utf8').toString('base64'),
    }),
  );
  if (s.transport.ambiente !== 'producao') return { token: '', expiresAt: null };
  const dados = parseDados(
    envelope,
    z.object({
      autenticar_procurador_token: z.string().min(1),
      data_hora_expiracao: z.string().nullish(),
    }),
  );
  const expires = dados.data_hora_expiracao ? new Date(dados.data_hora_expiracao) : null;
  return {
    token: dados.autenticar_procurador_token,
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
  };
}

export { createTrialTransport } from './trial';
export { createProductionTransport, type ProductionCredentials } from './production';
export { createFakeTransport, type FakeHandler, type FakeTransport } from './fake';
export { readGuidePdf, type GuidePdfFields } from './pdf';
