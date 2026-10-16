/**
 * Ambiente de testes (trial) do Integra Contador. Público, com token fixo de demonstração e
 * cota baixa. Só aceita os exemplos da documentação: cada serviço é trocado pelo seu
 * cenário (os mesmos corpos usados para gravar `fixtures/serpro`), e a resposta volta com
 * a identidade do pedido (`simulate.ts`). Nunca recebe dado real: o pedido não é enviado.
 */
import {
  parseEnvelope,
  postJson,
  requestBody,
  type SerproEndpoint,
  type SerproRequest,
  type SerproTransport,
} from './envelope';
import { simulateIdentity } from './simulate';

export const TRIAL_BASE_URL = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1';
// Token público de demonstração, publicado na documentação da Serpro. Não é segredo.
export const TRIAL_TOKEN = '06aef429-a981-3ec5-a1f8-71d38d86481e'; // gitleaks:allow

const MEI = '00000000000100';
const ZERO = '00000000000000';
const NINES = '99999999999999';

type Scenario = {
  endpoint: SerproEndpoint;
  contratante: string;
  /** Autor do pedido, quando o exemplo não usa o próprio contratante. */
  autor?: string;
  contribuinte: string;
  dados: Record<string, unknown>;
  /** Texto exato do campo dados, quando o trial só aceita o exemplo com espaços. */
  dadosText?: string;
};

/** Cenários da documentação que o trial aceita (gravados em 16/10/2026). */
export const TRIAL_SCENARIOS: Record<string, Scenario> = {
  GERARDASPDF21: {
    endpoint: 'Emitir',
    contratante: MEI,
    contribuinte: MEI,
    dados: { periodoApuracao: '201901' },
  },
  GERARDASCODBARRA22: {
    endpoint: 'Emitir',
    contratante: MEI,
    contribuinte: MEI,
    dados: { periodoApuracao: '201901' },
  },
  CONSULTIMADECREC14: {
    endpoint: 'Consultar',
    contratante: ZERO,
    contribuinte: ZERO,
    dados: { periodoApuracao: '201801' },
  },
  GERARDAS12: {
    endpoint: 'Emitir',
    contratante: MEI,
    contribuinte: MEI,
    dados: { periodoApuracao: '201801' },
    dadosText: '{ "periodoApuracao": "201801" }',
  },
  CONSRECIBO32: {
    endpoint: 'Consultar',
    contratante: ZERO,
    contribuinte: ZERO,
    dados: { categoria: 40, anoPA: '2027', mesPA: '11', numeroReciboEntrega: 24573 },
  },
  GERARGUIA31: {
    endpoint: 'Emitir',
    contratante: ZERO,
    contribuinte: ZERO,
    dados: { categoria: 'GERAL_MENSAL', anoPA: '2027', mesPA: '11', numeroReciboEntrega: 24573 },
  },
  PAGAMENTOS71: {
    endpoint: 'Consultar',
    contratante: NINES,
    contribuinte: NINES,
    dados: {
      intervaloDataArrecadacao: { dataInicial: '2019-09-01', dataFinal: '2019-11-30' },
      primeiroDaPagina: 0,
      tamanhoDaPagina: 100,
    },
  },
  COMPARRECADACAO72: {
    endpoint: 'Emitir',
    contratante: NINES,
    autor: '99999999999',
    contribuinte: '99999999999',
    dados: { numeroDocumento: '99999999999999999' },
  },
};

/** Troca o pedido pelo cenário da documentação (sem nenhum dado do pedido original). */
export function trialRequest(request: SerproRequest): SerproRequest {
  const scenario = TRIAL_SCENARIOS[request.service];
  if (!scenario) return request;
  return {
    ...request,
    endpoint: scenario.endpoint,
    parties: {
      contratante: scenario.contratante,
      autor: scenario.autor ?? scenario.contratante,
      contribuinte: scenario.contribuinte,
    },
    dados: scenario.dados,
    procuradorToken: null,
  };
}

/** Corpo do cenário; usa o texto exato do exemplo quando o trial exige. */
function trialBody(service: string, scenario: SerproRequest): string {
  const text = TRIAL_SCENARIOS[service]?.dadosText;
  if (!text) return requestBody(scenario);
  const body = JSON.parse(requestBody(scenario)) as { pedidoDados: { dados: string } };
  body.pedidoDados.dados = text;
  return JSON.stringify(body);
}

export function createTrialTransport(fetchImpl: typeof fetch = fetch): SerproTransport {
  return {
    ambiente: 'trial',
    async send(request) {
      // O termo de autorização não existe no trial: a conexão aceita sem token.
      if (request.service === 'ENVIOXMLASSINADO81')
        return { status: 200, mensagens: [], dados: null };
      const scenario = trialRequest(request);
      const res = await postJson(
        `${TRIAL_BASE_URL}/${scenario.endpoint}`,
        {
          Authorization: `Bearer ${TRIAL_TOKEN}`,
          accept: 'text/plain',
          'Content-Type': 'application/json',
        },
        trialBody(request.service, scenario),
        fetchImpl,
      );
      return simulateIdentity(request, parseEnvelope(res.status, res.body));
    },
  };
}
