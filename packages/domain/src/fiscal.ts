/**
 * Rotina fiscal da Serpro (incremento 4): competência aberta, dias úteis da consulta (S1),
 * dia do DAS do MEI (S2), linha digitável de arrecadação, disjuntor e limite do recálculo
 * (RN2). Regras puras, sem banco nem rede.
 */
import type { GuideStatus, GuideType } from './guides';
import type { TaxRegime } from './clients';

export const FISCAL_MODES = ['plataforma', 'proprio'] as const;
export type FiscalMode = (typeof FISCAL_MODES)[number];

export const FISCAL_CONNECTION_STATUSES = ['pendente', 'ativa', 'erro', 'desconectada'] as const;
export type FiscalConnectionStatus = (typeof FISCAL_CONNECTION_STATUSES)[number];

/** Tipos de guia que a Serpro gera sozinha neste incremento. */
export const FISCAL_WATCH_KINDS = ['das_mei', 'das_simples', 'dctfweb'] as const;
export type FiscalWatchKind = (typeof FISCAL_WATCH_KINDS)[number];

/**
 * Situação da rotina de uma empresa no mês:
 * - aguardando: ainda não achou a declaração (ou não chegou o dia do MEI);
 * - gerada: guia publicada, acompanhando o pagamento;
 * - revisao: a guia saiu, mas algum dado não conferiu; o escritório confere (RN17);
 * - paga: pagamento confirmado na Receita;
 * - desistiu: passou do prazo sem declaração ou sem pagamento.
 */
export const FISCAL_WATCH_STATUSES = [
  'aguardando',
  'gerada',
  'revisao',
  'paga',
  'desistiu',
] as const;
export type FiscalWatchStatus = (typeof FISCAL_WATCH_STATUSES)[number];

/** Qual guia a rotina acompanha para cada regime. */
export function watchKindForRegime(regime: TaxRegime): FiscalWatchKind {
  switch (regime) {
    case 'MEI':
      return 'das_mei';
    case 'SN':
      return 'das_simples';
    case 'LP':
    case 'LR':
      return 'dctfweb';
  }
}

export function guideTypeForWatch(kind: FiscalWatchKind): GuideType {
  return kind;
}

// ---------------------------------------------------------------------------
// Datas no fuso do escritório
// ---------------------------------------------------------------------------

/** Data local (AAAA-MM-DD), dia da semana (0 = domingo) e hora no fuso dado. */
export function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: Number(parts.day),
    hour: Number(parts.hour),
    weekday: weekdays.indexOf(parts.weekday!),
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

/** Dia útil: segunda a sexta. Feriados ficam para depois (a consulta só atrasa um dia). */
export function isBusinessDay(isoDate: string): boolean {
  const w = weekdayOf(isoDate);
  return w !== 0 && w !== 6;
}

export function nextBusinessDay(isoDate: string): string {
  let d = addDays(isoDate, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/** Instante de uma data local às `hour` horas no fuso dado. */
export function localDateAt(isoDate: string, hour: number, timeZone: string): Date {
  const guess = new Date(`${isoDate}T${String(hour).padStart(2, '0')}:00:00Z`);
  // Ajusta pela diferença do fuso naquele instante (sem horário de verão no Brasil hoje,
  // mas o cálculo vale para qualquer fuso).
  const local = localParts(guess, timeZone);
  const diffHours =
    (Date.parse(`${local.date}T${String(local.hour).padStart(2, '0')}:00:00Z`) - guess.getTime()) /
    3_600_000;
  return new Date(guess.getTime() - diffHours * 3_600_000);
}

/** Hora local em que a rotina consulta a Serpro. */
export const FISCAL_CHECK_HOUR = 8;

/** Próxima consulta (S1): próximo dia útil às 8 h, no fuso do escritório. */
export function nextCheckAt(now: Date, timeZone: string): Date {
  const { date } = localParts(now, timeZone);
  return localDateAt(nextBusinessDay(date), FISCAL_CHECK_HOUR, timeZone);
}

// ---------------------------------------------------------------------------
// Competência e prazos
// ---------------------------------------------------------------------------

/** Competência aberta: o mês anterior ao da data local ("2026-10-16" → "2026-09-01"). */
export function openPeriod(localDate: string): string {
  const y = Number(localDate.slice(0, 4));
  const m = Number(localDate.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

/** Dia 20 do mês seguinte à competência: vencimento nominal do DAS e da DCTFWeb. */
export function nominalDueDate(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-20`;
}

/** "2026-09-01" → "202609" (formato da Serpro). */
export function serproPeriod(period: string): string {
  return period.slice(0, 4) + period.slice(5, 7);
}

/** "20190220" → "2019-02-20"; null se não for data válida. */
export function parseSerproDate(value: string | number | null | undefined): string | null {
  const v = String(value ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "2019-02-20" → "20190220" */
export function toSerproDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** "31/08/2022" → "2022-08-31" */
export function parseBrDate(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return m ? parseSerproDate(`${m[3]}${m[2]}${m[1]}`) : null;
}

/** Valor em reais (número da Serpro) → centavos, sem erro de ponto flutuante. */
export function reaisToCents(value: number): number {
  return Math.round(value * 100);
}

/** "1.234,56" → 123456 */
export function brMoneyToCents(value: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value.trim());
  return m ? Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2]) : null;
}

/**
 * O que a rotina faz numa empresa, para a competência aberta, na data local dada.
 * - MEI (S2): espera o dia configurado e gera o DAS;
 * - Simples e DCTFWeb (S1): consulta a declaração a cada dia útil, do dia 1 até o vencimento.
 */
export function watchStartAt(
  kind: FiscalWatchKind,
  period: string,
  meiGenerationDay: number,
  timeZone: string,
): Date {
  const due = nominalDueDate(period);
  const month = due.slice(0, 8);
  if (kind === 'das_mei') {
    const day = Math.min(Math.max(meiGenerationDay, 1), 19);
    return localDateAt(`${month}${String(day).padStart(2, '0')}`, FISCAL_CHECK_HOUR, timeZone);
  }
  let first = `${month}01`;
  if (!isBusinessDay(first)) first = nextBusinessDay(first);
  return localDateAt(first, FISCAL_CHECK_HOUR, timeZone);
}

/** Depois do vencimento nominal, a rotina desiste de procurar a declaração. */
export function declarationSearchExpired(period: string, localDate: string): boolean {
  return localDate > nominalDueDate(period);
}

// ---------------------------------------------------------------------------
// Acompanhamento do pagamento
// ---------------------------------------------------------------------------

/** Dias depois do vencimento em que a rotina ainda procura o pagamento. */
export const PAYMENT_SEARCH_DAYS_AFTER_DUE = 30;

/**
 * Próxima consulta de pagamento: a cada 3 dias úteis, e sempre no dia útil seguinte ao
 * vencimento (quando a maioria paga). Custo baixo: cerca de 6 consultas por guia.
 */
export function nextPaymentCheck(localDate: string, dueDate: string): string | null {
  const limit = addDays(dueDate, PAYMENT_SEARCH_DAYS_AFTER_DUE);
  let d = localDate;
  for (let i = 0; i < 3; i++) d = nextBusinessDay(d);
  const afterDue = nextBusinessDay(dueDate);
  if (localDate < afterDue && afterDue < d) d = afterDue;
  return d > limit ? null : d;
}

// ---------------------------------------------------------------------------
// Linha digitável de arrecadação (48 dígitos: DAS, DARF, GPS)
// ---------------------------------------------------------------------------

function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv >= 10 ? 0 : dv;
}

/**
 * Confere a linha digitável de arrecadação (começa com 8): dígito de cada bloco e dígito
 * geral, no módulo indicado pelo 3º dígito (6 ou 7: módulo 10; 8 ou 9: módulo 11).
 * Devolve o valor em centavos quando o código traz valor efetivo (3º dígito 6 ou 8).
 */
export function checkCollectionLine(
  input: string,
): { line: string; amountCents: number | null } | null {
  const line = input.replace(/\D/g, '');
  if (line.length !== 48 || line[0] !== '8') return null;
  const blocks = [0, 1, 2, 3].map((i) => line.slice(i * 12, i * 12 + 11));
  const dvs = [0, 1, 2, 3].map((i) => Number(line[i * 12 + 11]));
  const barcode = blocks.join('');
  const kind = barcode[2];
  const modulo = kind === '6' || kind === '7' ? mod10 : kind === '8' || kind === '9' ? mod11 : null;
  if (!modulo) return null;
  if (blocks.some((b, i) => modulo(b) !== dvs[i])) return null;
  if (modulo(barcode.slice(0, 3) + barcode.slice(4)) !== Number(barcode[3])) return null;
  const amountCents = kind === '6' || kind === '8' ? Number(barcode.slice(4, 15)) : null;
  return { line, amountCents };
}

// ---------------------------------------------------------------------------
// Disjuntor por escritório
// ---------------------------------------------------------------------------

export const BREAKER_FAILURES = 5;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_OPEN_MS = 15 * 60_000;

export type BreakerState = {
  failures: number;
  firstFailureAt: Date | null;
  openUntil: Date | null;
};

export function breakerIsOpen(state: Pick<BreakerState, 'openUntil'>, now: Date): boolean {
  return !!state.openUntil && state.openUntil > now;
}

/** 5 falhas seguidas em 1 minuto abrem o disjuntor por 15 minutos. */
export function breakerAfterFailure(state: BreakerState, now: Date): BreakerState {
  const inWindow =
    state.firstFailureAt && now.getTime() - state.firstFailureAt.getTime() <= BREAKER_WINDOW_MS;
  const failures = inWindow ? state.failures + 1 : 1;
  const firstFailureAt = inWindow ? state.firstFailureAt : now;
  return {
    failures,
    firstFailureAt,
    openUntil:
      failures >= BREAKER_FAILURES ? new Date(now.getTime() + BREAKER_OPEN_MS) : state.openUntil,
  };
}

export const BREAKER_CLOSED: BreakerState = { failures: 0, firstFailureAt: null, openUntil: null };

// ---------------------------------------------------------------------------
// Recálculo (RN2)
// ---------------------------------------------------------------------------

export const RECALC_PER_GUIDE_PER_DAY = 3;

export type RecalcCheck =
  { ok: true } | { ok: false; reason: 'tipo' | 'status' | 'limite' | 'sem_numero' };

/** Só DAS vencido e não pago, com no máximo 3 recálculos por guia por dia. */
export function canRecalculate(
  guide: { type: GuideType; status: GuideStatus; externalNumber: string | null },
  recalcsToday: number,
): RecalcCheck {
  if (guide.type !== 'das_mei' && guide.type !== 'das_simples')
    return { ok: false, reason: 'tipo' };
  if (guide.status !== 'vencida') return { ok: false, reason: 'status' };
  if (!guide.externalNumber) return { ok: false, reason: 'sem_numero' };
  if (recalcsToday >= RECALC_PER_GUIDE_PER_DAY) return { ok: false, reason: 'limite' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Custo e idempotência
// ---------------------------------------------------------------------------

/** Preço por chamada na faixa 1 do Integra Contador, em centavos (a confirmar no contrato). */
export const SERPRO_PRICE_CENTS = { consulta: 24, emissao: 32, declaracao: 40, apoio: 0 } as const;
export type SerproCallKind = keyof typeof SERPRO_PRICE_CENTS;

/** Chave da emissão: repetir não gera segunda guia nem segunda cobrança da Serpro. */
export function emissionKey(input: {
  companyId: string;
  kind: FiscalWatchKind;
  period: string;
  consolidationDate?: string | null;
}): string {
  return [
    'emissao',
    input.companyId,
    input.kind,
    input.period,
    input.consolidationDate ?? 'original',
  ].join(':');
}
