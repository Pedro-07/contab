/**
 * Guias (incremento 3). Estados pela RN1 com a decisão I5 (pagamento sempre vale),
 * unicidade da guia ativa (RN5) e formatos de competência, valor, linha digitável e Pix.
 */

export const GUIDE_TYPES = [
  'das_simples',
  'das_mei',
  'dctfweb',
  'darf',
  'icms',
  'iss',
  'fgts',
  'pgfn',
  'outro',
] as const;
export type GuideType = (typeof GUIDE_TYPES)[number];

export const GUIDE_STATUSES = [
  'rascunho',
  'publicada',
  'vencida',
  'paga',
  'substituida',
  'cancelada',
] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

/** RN5: só pode haver uma guia nestes status por (empresa, tipo, competência). */
export const ACTIVE_GUIDE_STATUSES = ['rascunho', 'publicada', 'vencida'] as const;

export const GUIDE_SOURCES = ['avulsa', 'serpro', 'lote'] as const;
export type GuideSource = (typeof GUIDE_SOURCES)[number];

export type GuideAction = 'publicar' | 'vencer' | 'substituir' | 'cancelar' | 'pagar';

/**
 * RN1 com I5:
 * - rascunho → publicada → vencida → substituida
 * - rascunho, publicada ou vencida → cancelada
 * - pagamento confirmado: qualquer status, menos cancelada, vai para paga
 * - paga é final
 */
export function nextGuideStatus(current: GuideStatus, action: GuideAction): GuideStatus | null {
  switch (action) {
    case 'publicar':
      return current === 'rascunho' ? 'publicada' : null;
    case 'vencer':
      return current === 'publicada' ? 'vencida' : null;
    case 'substituir':
      return current === 'vencida' ? 'substituida' : null;
    case 'cancelar':
      return current === 'rascunho' || current === 'publicada' || current === 'vencida'
        ? 'cancelada'
        : null;
    case 'pagar':
      return current === 'cancelada' || current === 'paga' ? null : 'paga';
  }
}

export function isActiveGuide(status: GuideStatus): boolean {
  return (ACTIVE_GUIDE_STATUSES as readonly string[]).includes(status);
}

/** A régua e o link seguro só valem para guia que ainda pode ser paga (RN8, RN14). */
export function isPayableGuide(status: GuideStatus): boolean {
  return status === 'publicada' || status === 'vencida';
}

// ---------------------------------------------------------------------------
// Competência (date com dia 1)
// ---------------------------------------------------------------------------

/** "2026-10", "10/2026" ou "2026-10-01" → "2026-10-01". */
export function parsePeriod(input: string): string | null {
  const v = input.trim();
  let m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(v);
  if (m) return validMonth(m[1]!, m[2]!);
  m = /^(\d{2})\/(\d{4})$/.exec(v);
  if (m) return validMonth(m[2]!, m[1]!);
  return null;
}

function validMonth(year: string, month: string): string | null {
  const y = Number(year);
  const mo = Number(month);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  return `${year}-${month}-01`;
}

/** "2026-10-01" → "10/2026" */
export function formatPeriod(period: string): string {
  return `${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

/** Data ISO (AAAA-MM-DD) válida no calendário. */
export function parseIsoDate(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === input.trim() ? input.trim() : null;
}

// ---------------------------------------------------------------------------
// Dinheiro em centavos
// ---------------------------------------------------------------------------

/** "1.234,56", "1234,56", "1234.56" ou "R$ 10" → centavos. */
export function parseMoneyToCents(input: string): number | null {
  let v = input.replace(/R\$|\s/g, '');
  if (!v) return null;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [int, dec = ''] = v.split('.');
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Linha digitável e Pix
// ---------------------------------------------------------------------------

/**
 * Linha digitável: só dígitos, 47 (boleto bancário) ou 48 (arrecadação: DAS, DARF,
 * DARE, GPS). A conferência dos dígitos verificadores fica para a leitura de PDF.
 */
export function parseBarcodeLine(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 47 || digits.length === 48 ? digits : null;
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), usado no Pix copia e cola. */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Pix copia e cola (BR Code): começa com 000201 e termina com o CRC16 conferido. */
export function parsePixCode(input: string): string | null {
  const code = input.trim();
  if (!code.startsWith('000201') || code.length < 30 || code.length > 600) return null;
  const at = code.lastIndexOf('6304');
  if (at !== code.length - 8) return null;
  return crc16(code.slice(0, at + 4)) === code.slice(at + 4).toUpperCase() ? code : null;
}
