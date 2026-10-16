/**
 * Contrato do adaptador da Serpro contra as respostas gravadas do trial (fixtures/serpro).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyEnvelope,
  createFakeTransport,
  createTrialTransport,
  emitDasMei,
  emitDasSimples,
  emitDctfwebGuide,
  findDctfwebReceipt,
  findPayments,
  findSimplesDeclaration,
  parseEnvelope,
  paymentReceipt,
  readGuidePdf,
  requestBody,
  SerproError,
  type SerproParties,
} from './index';
import { recording, FAKE_ERRORS } from './fake';
import { TRIAL_SCENARIOS, trialRequest } from './trial';
import { fieldsFromText } from './pdf';

const parties: SerproParties = {
  contratante: '11222333000181',
  autor: '11222333000181',
  contribuinte: '45723174000110',
};

afterEach(() => vi.unstubAllGlobals());

describe('envelope', () => {
  it('limite do gateway (429) é temporário', () => {
    const error = (() => {
      try {
        parseEnvelope(429, recording('erro-limite-429'));
      } catch (e) {
        return e;
      }
    })() as SerproError;
    expect(error).toBeInstanceOf(SerproError);
    expect(error).toMatchObject({ kind: 'limite', temporary: true, code: '900807' });
  });

  it('pedido fora do cenário (HTTP 200 com status 400) é erro de dados', () => {
    expect(() => parseEnvelope(200, recording('erro-servico-inexistente'))).toThrow(
      expect.objectContaining({ kind: 'dados', temporary: false }),
    );
  });

  it('5xx e corpo que não é JSON', () => {
    expect(() => parseEnvelope(503, '')).toThrow(expect.objectContaining({ kind: 'indisponivel' }));
    expect(() => parseEnvelope(200, '<html>')).toThrow(
      expect.objectContaining({ kind: 'resposta' }),
    );
    expect(() => parseEnvelope(401, '{}')).toThrow(expect.objectContaining({ kind: 'credencial' }));
  });

  it('classifica procuração e "nada encontrado"', () => {
    const msg = (texto: string, status = 400) => ({
      status,
      mensagens: [{ codigo: 'X', texto }],
      dados: null,
    });
    expect(classifyEnvelope(msg('Procuração não encontrada para o procurador'), 200).kind).toBe(
      'procuracao',
    );
    expect(classifyEnvelope(msg('Não foi encontrada declaração'), 200).kind).toBe('nao_encontrado');
    expect(classifyEnvelope(msg('ok', 204), 200).kind).toBe('nao_encontrado');
  });

  it('monta o corpo com dados em texto JSON e tipo pelo tamanho do documento', () => {
    const body = JSON.parse(
      requestBody({
        endpoint: 'Emitir',
        system: 'PGMEI',
        service: 'GERARDASPDF21',
        version: '1.0',
        parties: { ...parties, contribuinte: '12345678901' },
        dados: { periodoApuracao: '202609' },
      }),
    );
    expect(body.contribuinte).toEqual({ numero: '12345678901', tipo: 1 });
    expect(body.contratante.tipo).toBe(2);
    expect(body.pedidoDados.dados).toBe('{"periodoApuracao":"202609"}');
  });
});

describe('serviços com as respostas gravadas', () => {
  const fake = createFakeTransport();
  const s = { transport: fake, parties };

  it('DAS do MEI: PDF, número, vencimento e valor, com a identidade do pedido', async () => {
    const das = await emitDasMei(s, { period: '2026-09-01' });
    expect(das).toMatchObject({
      cnpj: parties.contribuinte,
      period: '2026-09-01',
      dueDate: '2026-10-20',
      payUntil: '2026-10-20',
      amountCents: 7779,
    });
    expect(das.documentNumber).toMatch(/^\d{17}$/);
    expect(Buffer.from(das.pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(fake.calls.at(-1)).toMatchObject({
      endpoint: 'Emitir',
      system: 'PGMEI',
      service: 'GERARDASPDF21',
      dados: { periodoApuracao: '202609' },
    });
  });

  it('recálculo manda a data de consolidação e devolve a nova validade', async () => {
    const das = await emitDasSimples(s, { period: '2026-09-01', consolidationDate: '2026-10-30' });
    expect(fake.calls.at(-1)?.dados).toEqual({
      periodoApuracao: '202609',
      dataConsolidacao: '20261030',
    });
    expect(das.payUntil).toBe('2026-10-30');
    expect(das.amountCents).toBe(5815);
  });

  it('declaração do Simples encontrada e não encontrada', async () => {
    expect(await findSimplesDeclaration(s, '2026-09-01')).toEqual({
      declarationNumber: '00000000201801001',
    });
    fake.on('CONSULTIMADECREC14', () => FAKE_ERRORS.naoEncontrado());
    expect(await findSimplesDeclaration(s, '2026-09-01')).toBeNull();
    fake.on('CONSULTIMADECREC14', null);
  });

  it('DCTFWeb: recibo e PDF da guia', async () => {
    expect((await findDctfwebReceipt(s, '2026-09-01'))?.receiptPdf.length).toBeGreaterThan(8);
    const pdf = await emitDctfwebGuide(s, '2026-09-01');
    expect(fake.calls.at(-1)?.dados).toEqual({
      categoria: 'GERAL_MENSAL',
      anoPA: '2026',
      mesPA: '09',
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('pagamentos: só os documentos pagos voltam; comprovante em PDF', async () => {
    fake.markPaid('07000000000000001', '2026-10-19', 5815);
    expect(await findPayments(s, ['07000000000000001', '07000000000000002'])).toEqual([
      { documentNumber: '07000000000000001', paidOn: '2026-10-19', amountCents: 5815 },
    ]);
    expect(await findPayments(s, [])).toEqual([]);
    const receipt = await paymentReceipt(s, '07000000000000001');
    expect(Buffer.from(receipt.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('erro temporário passa adiante', async () => {
    fake.on('GERARDASPDF21', () => FAKE_ERRORS.indisponivel());
    await expect(emitDasMei(s, { period: '2026-09-01' })).rejects.toMatchObject({
      kind: 'indisponivel',
      temporary: true,
    });
    fake.on('GERARDASPDF21', null);
  });
});

describe('leitura do PDF (S3)', () => {
  it('DAS do Simples gravado: linha conferida, valor igual ao da linha, pagar até e número', async () => {
    const das = JSON.parse(JSON.parse(recording('pgdasd-gerardas12')).dados)[0];
    const fields = await readGuidePdf(new Uint8Array(Buffer.from(das.pdf, 'base64')));
    expect(fields).toEqual({
      line: '858700000006581503282225430720222149018016787725',
      lineAmountCents: 5815,
      amountCents: 5815,
      payUntil: '2022-08-31',
      documentNumber: '07202221401801678',
    });
  });

  it('PDFs de exemplo com linha zerada não passam (vão para revisão)', async () => {
    const mei = JSON.parse(JSON.parse(recording('pgmei-gerardaspdf21')).dados)[0];
    const fields = await readGuidePdf(new Uint8Array(Buffer.from(mei.pdf, 'base64')));
    expect(fields.line).toBeNull();
    expect(fields.amountCents).toBe(7779);
    expect(fields.documentNumber).toBeNull();

    const guia = JSON.parse(JSON.parse(recording('dctfweb-gerarguia31')).dados);
    const dctf = await readGuidePdf(new Uint8Array(Buffer.from(guia.PDFByteArrayBase64, 'base64')));
    expect(dctf).toMatchObject({ line: null, amountCents: 37396, payUntil: '2027-12-07' });
  });

  it('texto sem nada reconhecível', () => {
    expect(fieldsFromText('documento qualquer')).toEqual({
      line: null,
      lineAmountCents: null,
      amountCents: null,
      payUntil: null,
      documentNumber: null,
    });
  });
});

describe('trial', () => {
  it('troca o pedido pelo cenário da documentação, sem dado do pedido original', () => {
    const scenario = trialRequest({
      endpoint: 'Consultar',
      system: 'PGDASD',
      service: 'GERARDAS12',
      version: '1.0',
      parties,
      dados: { periodoApuracao: '202609' },
      procuradorToken: 'segredo',
    });
    expect(scenario).toMatchObject({
      endpoint: 'Emitir',
      parties: { contratante: '00000000000100', contribuinte: '00000000000100' },
      dados: TRIAL_SCENARIOS.GERARDAS12!.dados,
      procuradorToken: null,
    });
    expect(JSON.stringify(scenario)).not.toContain(parties.contribuinte);
  });

  it('chama o gateway do trial com o token público e devolve a identidade do pedido', async () => {
    const seen: Array<{ url: string; body: string; auth: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        body: String(init?.body),
        auth: (init?.headers as Record<string, string>).Authorization!,
      });
      return new Response(recording('pgmei-gerardaspdf21'), { status: 200 });
    }) as unknown as typeof fetch;
    const das = await emitDasMei(
      { transport: createTrialTransport(fetchImpl), parties },
      { period: '2026-09-01' },
    );
    expect(seen[0]!.url).toBe(
      'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Emitir',
    );
    expect(seen[0]!.auth).toMatch(/^Bearer /);
    expect(seen[0]!.body).not.toContain(parties.contribuinte);
    expect(das.cnpj).toBe(parties.contribuinte);
    expect(das.period).toBe('2026-09-01');
  });
});
