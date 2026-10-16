/**
 * Serpro simulada para desenvolvimento, testes e CI: responde com as gravações do trial
 * (`fixtures/serpro`), adaptadas ao pedido (`simulate.ts`). Não chama a rede.
 *
 * Os testes podem trocar a resposta de um serviço (`on`), marcar documentos como pagos
 * (`markPaid`) e conferir as chamadas feitas (`calls`).
 */
import { readFileSync } from 'node:fs';
import {
  checkEnvelope,
  parseEnvelope,
  SerproError,
  type SerproEnvelope,
  type SerproRequest,
  type SerproTransport,
} from './envelope';
import { simulateIdentity } from './simulate';

const FIXTURES = new URL('../../../../fixtures/serpro/', import.meta.url);

const RECORDINGS: Record<string, string> = {
  GERARDASPDF21: 'pgmei-gerardaspdf21',
  GERARDASCODBARRA22: 'pgmei-gerardascodbarra22',
  CONSULTIMADECREC14: 'pgdasd-consultimadecrec14',
  GERARDAS12: 'pgdasd-gerardas12',
  CONSRECIBO32: 'dctfweb-consrecibo32',
  GERARGUIA31: 'dctfweb-gerarguia31',
  COMPARRECADACAO72: 'pagtoweb-comparrecadacao72',
};

const cache = new Map<string, string>();

/** Lê uma gravação do trial (corpo HTTP cru). */
export function recording(name: string): string {
  let body = cache.get(name);
  if (!body) {
    body = readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8');
    cache.set(name, body);
  }
  return body;
}

/** Resposta de um serviço: envelope, erro, ou `undefined` para a gravação padrão. */
export type FakeHandler = (
  request: SerproRequest,
) => SerproEnvelope | Error | undefined | Promise<SerproEnvelope | Error | undefined>;

export type FakeTransport = SerproTransport & {
  calls: SerproRequest[];
  on(service: string, handler: FakeHandler | null): void;
  markPaid(documentNumber: string, paidOn: string, amountCents: number): void;
  reset(): void;
};

export function createFakeTransport(): FakeTransport {
  const handlers = new Map<string, FakeHandler>();
  const paid = new Map<string, { paidOn: string; amountCents: number }>();
  const calls: SerproRequest[] = [];

  return {
    ambiente: 'fake',
    calls,
    on(service, handler) {
      if (handler) handlers.set(service, handler);
      else handlers.delete(service);
    },
    markPaid(documentNumber, paidOn, amountCents) {
      paid.set(documentNumber, { paidOn, amountCents });
    },
    reset() {
      handlers.clear();
      paid.clear();
      calls.length = 0;
    },
    async send(request) {
      calls.push(structuredClone(request));
      const custom = await handlers.get(request.service)?.(request);
      if (custom instanceof Error) throw custom;
      if (custom) return checkEnvelope(custom);
      if (request.service === 'ENVIOXMLASSINADO81')
        return { status: 200, mensagens: [], dados: null };
      if (request.service === 'PAGAMENTOS71') {
        const wanted = (request.dados.numeroDocumentoLista as string[] | undefined) ?? [];
        const rows = wanted.flatMap((numero) => {
          const p = paid.get(numero);
          return p
            ? [
                {
                  numeroDocumento: numero,
                  dataArrecadacao: `${p.paidOn}T00:00:00-03:00`,
                  valorTotal: p.amountCents / 100,
                },
              ]
            : [];
        });
        return { status: 200, mensagens: [], dados: JSON.stringify(rows) };
      }
      const name = RECORDINGS[request.service];
      if (!name) throw new SerproError('dados', false, 200, 'servico_sem_gravacao');
      return simulateIdentity(request, parseEnvelope(200, recording(name)));
    },
  };
}

/** Envelopes de erro prontos para os testes. */
export const FAKE_ERRORS = {
  limite: () => new SerproError('limite', true, 429, '900807'),
  indisponivel: () => new SerproError('indisponivel', true, 503),
  naoEncontrado: (): SerproEnvelope => ({
    status: 204,
    mensagens: [{ codigo: 'Aviso', texto: 'Não foi encontrada declaração para o período.' }],
    dados: null,
  }),
};
