import { describe, expect, it } from 'vitest';
import { chooseChannels, type ChannelInput } from './delivery-channels';
import {
  formatCents,
  formatPeriod,
  GUIDE_STATUSES,
  nextGuideStatus,
  parseBarcodeLine,
  parseIsoDate,
  parseMoneyToCents,
  parsePeriod,
  parsePixCode,
} from './guides';
import { isPastDue, overdueAt, reminderAt, todayIn, zonedTime } from './regua';
import { renderTemplate, TEMPLATE_LIBRARY, templateValues } from './templates';

describe('estados da guia (RN1 com I5)', () => {
  it('segue o caminho normal', () => {
    expect(nextGuideStatus('rascunho', 'publicar')).toBe('publicada');
    expect(nextGuideStatus('publicada', 'vencer')).toBe('vencida');
    expect(nextGuideStatus('vencida', 'substituir')).toBe('substituida');
    expect(nextGuideStatus('publicada', 'cancelar')).toBe('cancelada');
  });

  it('pagamento vale para qualquer guia não cancelada, inclusive vencida e substituída', () => {
    for (const s of ['rascunho', 'publicada', 'vencida', 'substituida'] as const) {
      expect(nextGuideStatus(s, 'pagar'), s).toBe('paga');
    }
    expect(nextGuideStatus('cancelada', 'pagar')).toBeNull();
  });

  it('paga é final', () => {
    for (const action of ['publicar', 'vencer', 'substituir', 'cancelar', 'pagar'] as const) {
      expect(nextGuideStatus('paga', action), action).toBeNull();
    }
  });

  it('transições inválidas', () => {
    expect(nextGuideStatus('publicada', 'substituir')).toBeNull();
    expect(nextGuideStatus('rascunho', 'vencer')).toBeNull();
    expect(nextGuideStatus('substituida', 'cancelar')).toBeNull();
    expect(GUIDE_STATUSES).toHaveLength(6);
  });
});

describe('formatos', () => {
  it('competência', () => {
    expect(parsePeriod('2026-10')).toBe('2026-10-01');
    expect(parsePeriod('10/2026')).toBe('2026-10-01');
    expect(parsePeriod('2026-13')).toBeNull();
    expect(formatPeriod('2026-10-01')).toBe('10/2026');
  });

  it('data ISO válida no calendário', () => {
    expect(parseIsoDate('2026-02-28')).toBe('2026-02-28');
    expect(parseIsoDate('2026-02-30')).toBeNull();
  });

  it('valor em centavos', () => {
    expect(parseMoneyToCents('1.234,56')).toBe(123456);
    expect(parseMoneyToCents('R$ 10')).toBe(1000);
    expect(parseMoneyToCents('99.9')).toBe(9990);
    expect(parseMoneyToCents('0')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(formatCents(123456)).toMatch(/R\$\s1\.234,56/);
  });

  it('linha digitável de 47 ou 48 dígitos', () => {
    expect(parseBarcodeLine('858600000123 456000000000 000000000000 000000000000')).toHaveLength(
      48,
    );
    expect(parseBarcodeLine('123')).toBeNull();
  });

  it('Pix copia e cola com CRC conferido (exemplo do manual do BR Code)', () => {
    const pix =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
    expect(parsePixCode(pix)).toBe(pix);
    expect(parsePixCode(pix.replace('Fulano', 'Beltra'))).toBeNull();
    expect(parsePixCode('qualquer coisa')).toBeNull();
  });
});

describe('régua no fuso do escritório', () => {
  const settings = { timezone: 'America/Fortaleza', reminderDaysBefore: 3, deliveryHour: 9 };

  it('converte horário local de Fortaleza (UTC−3) para UTC', () => {
    expect(zonedTime('2026-11-20', 9, 'America/Fortaleza').toISOString()).toBe(
      '2026-11-20T12:00:00.000Z',
    );
  });

  it('lembrete 3 dias antes às 9h e aviso de vencida no dia seguinte às 9h', () => {
    expect(reminderAt('2026-11-20', settings)?.toISOString()).toBe('2026-11-17T12:00:00.000Z');
    expect(overdueAt('2026-11-20', settings).toISOString()).toBe('2026-11-21T12:00:00.000Z');
    expect(reminderAt('2026-11-20', { ...settings, reminderDaysBefore: 0 })).toBeNull();
  });

  it('vence só depois da meia-noite local do dia seguinte', () => {
    expect(isPastDue('2026-11-20', new Date('2026-11-21T02:59:00Z'), 'America/Fortaleza')).toBe(
      false,
    );
    expect(isPastDue('2026-11-20', new Date('2026-11-21T03:00:00Z'), 'America/Fortaleza')).toBe(
      true,
    );
    expect(todayIn('America/Fortaleza', new Date('2026-11-21T02:00:00Z'))).toBe('2026-11-20');
  });

  it('funciona em fuso com horário de verão', () => {
    expect(zonedTime('2026-07-01', 9, 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(zonedTime('2026-01-15', 9, 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });
});

describe('templates', () => {
  it('toda variável usada no corpo está definida e vice-versa', () => {
    for (const def of Object.values(TEMPLATE_LIBRARY)) {
      const used = new Set([...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
      expect(used.size, def.key).toBe(def.variables.length);
      expect(Math.max(...used), def.key).toBe(def.variables.length);
    }
  });

  it('preenche e limpa os valores', () => {
    const def = TEMPLATE_LIBRARY.documento_disponivel;
    const values = templateValues(def, {
      contato: 'Maria\nSilva',
      escritorio: 'Contact',
      documento: '',
      empresa: 'Padaria',
    });
    expect(values).toEqual(['Maria Silva', 'Contact', '-', 'Padaria']);
    expect(renderTemplate(def.body, values)).toBe(
      'Olá, Maria Silva. O escritório Contact enviou o documento "-" da empresa Padaria.',
    );
    expect(() => templateValues(def, { contato: 'x' })).toThrow(/escritorio/);
  });
});

describe('escolha do canal (P25)', () => {
  const base: ChannelInput = {
    preferred: 'whatsapp',
    phone: '+5598990000001',
    email: 'a@exemplo.test',
    whatsappOptIn: true,
    emailOptIn: true,
    whatsappReady: true,
  };

  it('usa o canal preferido', () => {
    expect(chooseChannels(base)).toEqual({ channels: ['whatsapp'], whatsappSkipped: null });
    expect(chooseChannels({ ...base, preferred: 'email' }).channels).toEqual(['email']);
    expect(chooseChannels({ ...base, preferred: 'ambos' }).channels).toEqual(['whatsapp', 'email']);
  });

  it('desvia para o e-mail quando o WhatsApp não pode sair (CA9)', () => {
    expect(chooseChannels({ ...base, whatsappReady: false })).toEqual({
      channels: ['email'],
      whatsappSkipped: 'indisponivel',
    });
    expect(chooseChannels({ ...base, whatsappOptIn: false })).toEqual({
      channels: ['email'],
      whatsappSkipped: 'sem_autorizacao',
    });
    expect(chooseChannels({ ...base, phone: null }).whatsappSkipped).toBe('sem_telefone');
  });

  it('sem e-mail autorizado, não há desvio', () => {
    expect(chooseChannels({ ...base, whatsappReady: false, emailOptIn: false }).channels).toEqual(
      [],
    );
  });
});
