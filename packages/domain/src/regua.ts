/**
 * Régua do núcleo (incremento 3): quando sai o lembrete e o aviso de vencida, sempre no
 * fuso do escritório (tenant_settings.timezone), com antecedência e horário configuráveis.
 */

export type ReguaSettings = {
  timezone: string;
  /** Dias antes do vencimento para o lembrete (0 = sem lembrete). */
  reminderDaysBefore: number;
  /** Hora local de envio (0 a 23). */
  deliveryHour: number;
};

export const DEFAULT_REGUA: Omit<ReguaSettings, 'timezone'> = {
  reminderDaysBefore: 3,
  deliveryHour: 9,
};

/** Diferença, em minutos, entre o horário local do fuso e o UTC naquele instante. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Instante UTC de uma data e hora locais no fuso dado. */
export function zonedTime(isoDate: string, hour: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // Segunda passada cobre a troca de horário de verão perto do horário pedido.
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Quando sai o lembrete, ou null se a antecedência for 0. */
export function reminderAt(dueDate: string, settings: ReguaSettings): Date | null {
  if (settings.reminderDaysBefore <= 0) return null;
  return zonedTime(
    addDays(dueDate, -settings.reminderDaysBefore),
    settings.deliveryHour,
    settings.timezone,
  );
}

/** A guia vence no fim do dia do vencimento; o aviso sai no dia seguinte, no horário. */
export function overdueAt(dueDate: string, settings: ReguaSettings): Date {
  return zonedTime(addDays(dueDate, 1), settings.deliveryHour, settings.timezone);
}

/** A guia já está vencida (passou o dia do vencimento no fuso do escritório)? */
export function isPastDue(dueDate: string, now: Date, timeZone: string): boolean {
  return now.getTime() >= zonedTime(addDays(dueDate, 1), 0, timeZone).getTime();
}

/** Data de hoje (AAAA-MM-DD) no fuso do escritório. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
