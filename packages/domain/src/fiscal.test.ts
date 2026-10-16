import { describe, expect, it } from 'vitest';
import {
  BREAKER_CLOSED,
  breakerAfterFailure,
  breakerIsOpen,
  brMoneyToCents,
  canRecalculate,
  checkCollectionLine,
  declarationSearchExpired,
  emissionKey,
  localDateAt,
  nextBusinessDay,
  nextCheckAt,
  nextPaymentCheck,
  nominalDueDate,
  openPeriod,
  parseBrDate,
  parseSerproDate,
  reaisToCents,
  serproPeriod,
  watchKindForRegime,
  watchStartAt,
} from './fiscal';

const TZ = 'America/Fortaleza';

describe('linha digitável de arrecadação', () => {
  // Linha do DAS do trial da Serpro (fixtures/serpro/pgdasd-gerardas12.json).
  const real = '85870000000 6 58150328222 5 43072022214 9 01801678772 5';

  it('confere os dígitos e lê o valor', () => {
    expect(checkCollectionLine(real)).toEqual({
      line: '858700000006581503282225430720222149018016787725',
      amountCents: 5815,
    });
  });

  it('recusa dígito trocado, linha zerada e tamanho errado', () => {
    expect(checkCollectionLine(real.replace('6 5815', '7 5815'))).toBeNull();
    expect(checkCollectionLine(real.replace('43072022214', '43072022215'))).toBeNull();
    expect(checkCollectionLine('00000000000 0 '.repeat(4))).toBeNull();
    expect(checkCollectionLine('8587')).toBeNull();
  });
});

describe('datas e competência', () => {
  it('competência aberta é o mês anterior', () => {
    expect(openPeriod('2026-10-16')).toBe('2026-09-01');
    expect(openPeriod('2027-01-05')).toBe('2026-12-01');
  });

  it('vencimento nominal no dia 20 do mês seguinte', () => {
    expect(nominalDueDate('2026-09-01')).toBe('2026-10-20');
    expect(nominalDueDate('2026-12-01')).toBe('2027-01-20');
  });

  it('formatos da Serpro', () => {
    expect(serproPeriod('2026-09-01')).toBe('202609');
    expect(parseSerproDate('20190220')).toBe('2019-02-20');
    expect(parseSerproDate('20190231')).toBeNull();
    expect(parseBrDate('31/08/2022')).toBe('2022-08-31');
    expect(reaisToCents(77.79)).toBe(7779);
    expect(reaisToCents(0.29)).toBe(29);
    expect(brMoneyToCents('1.373,96')).toBe(137396);
    expect(brMoneyToCents('58,15')).toBe(5815);
    expect(brMoneyToCents('58.15')).toBeNull();
  });

  it('dia útil pula o fim de semana', () => {
    expect(nextBusinessDay('2026-10-16')).toBe('2026-10-19'); // sexta → segunda
    expect(nextBusinessDay('2026-10-19')).toBe('2026-10-20');
  });

  it('próxima consulta no próximo dia útil às 8 h locais (S1)', () => {
    // Sexta 16/10/2026 às 10 h em Fortaleza (UTC-3) → segunda 19/10 às 8 h (11 h UTC).
    const now = new Date('2026-10-16T13:00:00Z');
    expect(nextCheckAt(now, TZ).toISOString()).toBe('2026-10-19T11:00:00.000Z');
    expect(localDateAt('2026-10-19', 8, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-19T11:00:00.000Z',
    );
  });

  it('MEI começa no dia configurado; Simples no primeiro dia útil (S1, S2)', () => {
    expect(watchStartAt('das_mei', '2026-09-01', 5, TZ).toISOString()).toBe(
      '2026-10-05T11:00:00.000Z',
    );
    // 01/11/2026 é domingo.
    expect(watchStartAt('das_simples', '2026-10-01', 5, TZ).toISOString()).toBe(
      '2026-11-02T11:00:00.000Z',
    );
  });

  it('desiste da declaração depois do vencimento', () => {
    expect(declarationSearchExpired('2026-09-01', '2026-10-20')).toBe(false);
    expect(declarationSearchExpired('2026-09-01', '2026-10-21')).toBe(true);
  });

  it('pagamento: a cada 3 dias úteis e no dia útil depois do vencimento', () => {
    expect(nextPaymentCheck('2026-10-05', '2026-10-20')).toBe('2026-10-08');
    expect(nextPaymentCheck('2026-10-19', '2026-10-20')).toBe('2026-10-21');
    expect(nextPaymentCheck('2026-11-25', '2026-10-20')).toBeNull();
  });
});

describe('regime', () => {
  it('MEI, Simples e lucro presumido ou real', () => {
    expect(watchKindForRegime('MEI')).toBe('das_mei');
    expect(watchKindForRegime('SN')).toBe('das_simples');
    expect(watchKindForRegime('LP')).toBe('dctfweb');
    expect(watchKindForRegime('LR')).toBe('dctfweb');
  });
});

describe('disjuntor', () => {
  it('abre com 5 falhas em 1 minuto e não abre se espaçadas', () => {
    const t0 = new Date('2026-10-16T12:00:00Z');
    let s = BREAKER_CLOSED;
    for (let i = 0; i < 5; i++) s = breakerAfterFailure(s, new Date(t0.getTime() + i * 5_000));
    expect(breakerIsOpen(s, new Date(t0.getTime() + 30_000))).toBe(true);
    expect(breakerIsOpen(s, new Date(t0.getTime() + 20 * 60_000))).toBe(false);

    let spaced = BREAKER_CLOSED;
    for (let i = 0; i < 5; i++)
      spaced = breakerAfterFailure(spaced, new Date(t0.getTime() + i * 61_000));
    expect(breakerIsOpen(spaced, new Date(t0.getTime() + 5 * 61_000))).toBe(false);
  });
});

describe('recálculo (RN2)', () => {
  const vencida = { type: 'das_simples' as const, status: 'vencida' as const, externalNumber: '1' };

  it('só DAS vencido, com número, até 3 por dia', () => {
    expect(canRecalculate(vencida, 0)).toEqual({ ok: true });
    expect(canRecalculate(vencida, 3)).toEqual({ ok: false, reason: 'limite' });
    expect(canRecalculate({ ...vencida, status: 'publicada' }, 0)).toEqual({
      ok: false,
      reason: 'status',
    });
    expect(canRecalculate({ ...vencida, status: 'paga' }, 0).ok).toBe(false);
    expect(canRecalculate({ ...vencida, type: 'dctfweb' }, 0)).toEqual({
      ok: false,
      reason: 'tipo',
    });
    expect(canRecalculate({ ...vencida, externalNumber: null }, 0).ok).toBe(false);
  });
});

it('chave de emissão inclui a data de consolidação', () => {
  const base = { companyId: 'c1', kind: 'das_mei' as const, period: '2026-09-01' };
  expect(emissionKey(base)).toBe('emissao:c1:das_mei:2026-09-01:original');
  expect(emissionKey({ ...base, consolidationDate: '2026-10-25' })).not.toBe(emissionKey(base));
});
