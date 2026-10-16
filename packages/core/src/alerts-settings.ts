/** Alertas internos (CA9) e Configurações › Entrega (incremento 3). */
import {
  getTenantSettings,
  listOpenAlerts,
  NotFoundError,
  recordAudit,
  resolveAlert,
  updateDeliverySettings,
  updateMeiGenerationDay,
  withTenant,
  type TenantContext,
} from '@contab/db';
import { canManageConnections, canManageGuides } from '@contab/domain';
import { z } from 'zod';
import { ClientInputError, uuidOrNotFound } from './clients';
import { actorRole, deny, logNotFound } from './guard';

export async function listTenantAlerts(ctx: TenantContext) {
  if (!actorRole(ctx)) await deny(ctx, 'Sem acesso.', 'tenant_alert');
  return withTenant(ctx, (tx) => listOpenAlerts(tx));
}

export async function resolveTenantAlert(ctx: TenantContext, alertId: string): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageGuides(role))
    await deny(ctx, 'Seu papel não permite resolver alertas.', 'tenant_alert');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const ok = await resolveAlert(tx, uuidOrNotFound(alertId, 'tenant_alert'));
      if (!ok) throw new NotFoundError('tenant_alert', alertId);
    }),
  );
}

export async function getDeliverySettings(ctx: TenantContext) {
  if (!actorRole(ctx)) await deny(ctx, 'Sem acesso.', 'tenant_settings');
  return withTenant(ctx, async (tx) => {
    const s = await getTenantSettings(tx);
    return {
      timezone: s?.timezone ?? 'America/Fortaleza',
      reminderDaysBefore: s?.reminderDaysBefore ?? 3,
      deliveryHour: s?.deliveryHour ?? 9,
      replyToEmail: s?.replyToEmail ?? null,
      meiGenerationDay: s?.meiGenerationDay ?? 5,
    };
  });
}

const settingsSchema = z.object({
  reminderDaysBefore: z.coerce
    .number()
    .int()
    .min(0, 'Use de 0 a 30 dias.')
    .max(30, 'Use de 0 a 30 dias.'),
  deliveryHour: z.coerce.number().int().min(6, 'Use de 6 a 20 h.').max(20, 'Use de 6 a 20 h.'),
  replyToEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail de resposta inválido.'),
  // Dia do DAS do MEI (S2): até o dia 19, antes do vencimento do dia 20.
  meiGenerationDay: z.coerce
    .number()
    .int()
    .min(1, 'Use um dia de 1 a 19.')
    .max(19, 'Use um dia de 1 a 19.')
    .default(5),
});

export async function saveDeliverySettings(
  ctx: TenantContext,
  input: z.input<typeof settingsSchema>,
): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageConnections(role))
    await deny(ctx, 'Seu papel não permite alterar as configurações.', 'tenant_settings');
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success)
    throw new ClientInputError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  await withTenant(ctx, async (tx) => {
    const { meiGenerationDay, ...delivery } = parsed.data;
    await updateDeliverySettings(tx, delivery);
    await updateMeiGenerationDay(tx, meiGenerationDay);
    await recordAudit(tx, ctx, {
      action: 'configuracao.entrega_alterada',
      resourceType: 'tenant_settings',
      metadata: {
        lembrete_dias: parsed.data.reminderDaysBefore,
        hora: parsed.data.deliveryHour,
        dia_mei: parsed.data.meiGenerationDay,
      },
    });
  });
}
