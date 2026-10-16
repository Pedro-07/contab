/**
 * Simulação para o trial e para as respostas gravadas: o ambiente de testes da Serpro só
 * aceita os exemplos da documentação, sempre com os mesmos CNPJs e competências fictícios.
 * Para a rotina rodar de ponta a ponta em desenvolvimento e nos testes, a resposta volta
 * com a identidade do pedido (CNPJ, competência, número do documento) e as datas da
 * competência pedida. O PDF continua o do exemplo.
 *
 * Nunca usado em produção: a validação do ambiente exige SERPRO_PROVIDER=producao.
 */
import { nominalDueDate, toSerproDate } from '@contab/domain';
import { createHash } from 'node:crypto';
import type { SerproEnvelope, SerproRequest } from './envelope';

function requestedPeriod(request: SerproRequest): string | null {
  const p = request.dados.periodoApuracao;
  return typeof p === 'string' && /^\d{6}$/.test(p) ? p : null;
}

/** Número de documento estável por empresa, competência e data de consolidação. */
function simulatedDocumentNumber(request: SerproRequest): string {
  const seed = [request.parties.contribuinte, request.service, JSON.stringify(request.dados)].join(
    '|',
  );
  const digits = BigInt(
    '0x' + createHash('sha256').update(seed).digest('hex').slice(0, 15),
  ).toString();
  return ('07' + digits).slice(0, 17).padEnd(17, '0');
}

export function simulateIdentity(request: SerproRequest, envelope: SerproEnvelope): SerproEnvelope {
  if (!envelope.dados) return envelope;
  let data: unknown;
  try {
    data = JSON.parse(envelope.dados);
  } catch {
    return envelope;
  }
  const period = requestedPeriod(request);
  const isoPeriod = period ? `${period.slice(0, 4)}-${period.slice(4)}-01` : null;
  const due = isoPeriod ? toSerproDate(nominalDueDate(isoPeriod)) : null;
  const consolidation =
    typeof request.dados.dataConsolidacao === 'string' ? request.dados.dataConsolidacao : null;
  const documents = Array.isArray(request.dados.numeroDocumentoLista)
    ? (request.dados.numeroDocumentoLista as string[])
    : null;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === 'cnpjCompleto') out[key] = request.parties.contribuinte;
      else if (key === 'periodoApuracao' && period)
        out[key] = typeof v === 'number' ? Number(period) : period;
      else if (key === 'dataVencimento' && due && typeof v === 'string' && /^\d{8}$/.test(v))
        out[key] = due;
      else if (key === 'dataLimiteAcolhimento' && due && typeof v === 'string')
        out[key] = consolidation ?? due;
      else if (key === 'numeroDocumento' && documents?.[0] && typeof v === 'string')
        out[key] = documents[0];
      else if (key === 'numeroDocumento' && !documents && typeof v === 'string')
        out[key] = simulatedDocumentNumber(request);
      else out[key] = walk(v);
    }
    return out;
  };
  return { ...envelope, dados: JSON.stringify(walk(data)) };
}
