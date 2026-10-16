/**
 * Leitura do PDF da guia (decisão S3): só o texto do PDF (pdf.js, sem OCR). Tira a linha
 * digitável, o valor, a data "pagar até" e o número do documento. A linha é conferida pelos
 * dígitos verificadores; quem chama compara o valor da linha com o da Serpro.
 *
 * O Pix copia e cola não vem no texto: está só no QR Code (imagem). Fica para depois.
 */
import { brMoneyToCents, checkCollectionLine, parseBrDate } from '@contab/domain';

export type GuidePdfFields = {
  /** Linha digitável conferida (48 dígitos), ou null se não achou uma válida. */
  line: string | null;
  /** Valor gravado no código de barras (centavos). */
  lineAmountCents: number | null;
  /** "Valor Total do Documento" */
  amountCents: number | null;
  /** "Pagar este documento até" */
  payUntil: string | null;
  /** "Número:" no formato 00.00.00000.0000000-0, sem pontos (null se zerado). */
  documentNumber: string | null;
};

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | undefined;

/** Texto corrido do PDF, sem as barras de separação de células. */
export async function pdfText(bytes: Uint8Array, maxPages = 3): Promise<string> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const lib = await pdfjs;
  const task = lib.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) if ('str' in item) parts.push(item.str);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } finally {
    await task.destroy();
  }
}

const LINE = /\b(\d{11}) ?(\d) +(\d{11}) ?(\d) +(\d{11}) ?(\d) +(\d{11}) ?(\d)\b/g;

export function fieldsFromText(text: string): GuidePdfFields {
  let line: string | null = null;
  let lineAmountCents: number | null = null;
  for (const m of text.matchAll(LINE)) {
    const checked = checkCollectionLine(m.slice(1, 9).join(''));
    if (checked) {
      line = checked.line;
      lineAmountCents = checked.amountCents;
      break;
    }
  }
  const amount = /Valor Total do Documento ([\d.]+,\d{2})/.exec(text)?.[1];
  const payUntil = /Pagar (?:este documento )?até:? (\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1];
  const number = /(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/.exec(text)?.[1]?.replace(/\D/g, '');
  return {
    line,
    lineAmountCents,
    amountCents: amount ? brMoneyToCents(amount) : null,
    payUntil: payUntil ? parseBrDate(payUntil) : null,
    documentNumber: number && /[1-9]/.test(number) ? number : null,
  };
}

export async function readGuidePdf(bytes: Uint8Array): Promise<GuidePdfFields> {
  return fieldsFromText(await pdfText(bytes));
}
