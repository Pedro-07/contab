/**
 * Régua do núcleo (incremento 3): lembrete antes do vencimento, guia vencida e (pelos
 * envios do pagamento) pago. Roda por escritório (job regua.tenant), no fuso dele. Os
 * envios são idempotentes pela chave de deliveries; rodar duas vezes não repete mensagem.
 */
import {
  getTenantSettings,
  listGuidesForRegua,
  recordGuideEvent,
  updateGuideStatus,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  DEFAULT_REGUA,
  isPastDue,
  overdueAt,
  reminderAt,
  todayIn,
  type ReguaSettings,
} from '@contab/domain';
import { nowOf, type DeliveryDeps } from './delivery-deps';

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type ReguaResult = { vencidas: number; lembretes: number; avisos: number };

export async function runRegua(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
): Promise<ReguaResult> {
  const now = nowOf(deps);
  const row = await getTenantSettings(tx);
  const settings: ReguaSettings = {
    timezone: row?.timezone ?? 'America/Fortaleza',
    reminderDaysBefore: row?.reminderDaysBefore ?? DEFAULT_REGUA.reminderDaysBefore,
    deliveryHour: row?.deliveryHour ?? DEFAULT_REGUA.deliveryHour,
  };
  const horizon = addDays(todayIn(settings.timezone, now), settings.reminderDaysBefore);
  const result: ReguaResult = { vencidas: 0, lembretes: 0, avisos: 0 };

  for (const guide of await listGuidesForRegua(tx, horizon)) {
    if (isPastDue(guide.dueDate, now, settings.timezone)) {
      if (guide.status === 'publicada') {
        const updated = await updateGuideStatus(tx, guide.id, ['publicada'], 'vencida');
        if (updated) {
          await recordGuideEvent(tx, ctx.tenantId, ctx.actor, {
            guideId: guide.id,
            from: 'publicada',
            to: 'vencida',
            reason: 'vencimento',
          });
          result.vencidas++;
        }
      }
      if (now >= overdueAt(guide.dueDate, settings)) {
        await enqueue(deps.boss, ctx, tx, 'delivery.plan', {
          itemType: 'guia',
          itemId: guide.id,
          trigger: 'vencida',
        });
        result.avisos++;
      }
      continue;
    }
    const remindAt = reminderAt(guide.dueDate, settings);
    if (guide.status === 'publicada' && remindAt && now >= remindAt) {
      await enqueue(deps.boss, ctx, tx, 'delivery.plan', {
        itemType: 'guia',
        itemId: guide.id,
        trigger: 'lembrete',
      });
      result.lembretes++;
    }
  }
  return result;
}
