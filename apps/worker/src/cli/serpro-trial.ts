/**
 * Confere, ao vivo, que o ambiente de testes da Serpro ainda responde no formato que o
 * adaptador espera (plano do incremento 4, seção 7). Fora do CI: o trial tem cota baixa.
 * Chama um serviço por vez, com 8 s entre eles. Nenhum dado real é enviado.
 * Uso: pnpm serpro:trial
 */
import {
  createTrialTransport,
  emitDasMei,
  emitDasSimples,
  emitDctfwebGuide,
  findDctfwebReceipt,
  findPayments,
  findSimplesDeclaration,
  paymentReceipt,
  readGuidePdf,
  SerproError,
} from '@contab/adapters/serpro';

const s = {
  transport: createTrialTransport(),
  // CNPJs fictícios: o trial troca o pedido pelo cenário da documentação.
  parties: {
    contratante: '11222333000181',
    autor: '11222333000181',
    contribuinte: '44555666000181',
  },
};
const period = '2026-09-01';

const checks: Array<[string, () => Promise<string>]> = [
  ['PGMEI/GERARDASPDF21', async () => `R$ ${(await emitDasMei(s, { period })).amountCents / 100}`],
  [
    'PGDASD/CONSULTIMADECREC14',
    async () =>
      (await findSimplesDeclaration(s, period)) ? 'declaração encontrada' : 'sem declaração',
  ],
  [
    'PGDASD/GERARDAS12 + leitura do PDF',
    async () => {
      const das = await emitDasSimples(s, { period });
      const pdf = await readGuidePdf(das.pdf);
      if (pdf.lineAmountCents !== das.amountCents) throw new Error('linha digitável não confere');
      return `linha ${pdf.line}`;
    },
  ],
  [
    'DCTFWEB/CONSRECIBO32',
    async () => ((await findDctfwebReceipt(s, period)) ? 'recibo encontrado' : 'sem recibo'),
  ],
  ['DCTFWEB/GERARGUIA31', async () => `${(await emitDctfwebGuide(s, period)).length} bytes de PDF`],
  [
    'PAGTOWEB/PAGAMENTOS71',
    async () => `${(await findPayments(s, ['07000000000000001'])).length} pagamento(s)`,
  ],
  [
    'PAGTOWEB/COMPARRECADACAO72',
    async () => `${(await paymentReceipt(s, '07000000000000001')).length} bytes de PDF`,
  ],
];

let failures = 0;
for (const [i, [name, run]] of checks.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 8_000));
  try {
    console.log(`ok    ${name}: ${await run()}`);
  } catch (error) {
    failures++;
    const detail =
      error instanceof SerproError ? `${error.kind} ${error.code ?? ''}` : (error as Error).message;
    console.log(`FALHA ${name}: ${detail}`);
  }
}
process.exit(failures ? 1 : 0);
