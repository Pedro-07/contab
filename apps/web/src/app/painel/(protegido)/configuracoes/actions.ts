'use server';

import { saveDeliverySettings } from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';

export async function saveSettingsAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/configuracoes', async (ctx) => {
    await saveDeliverySettings(ctx, {
      reminderDaysBefore: formString(formData, 'reminderDaysBefore'),
      deliveryHour: formString(formData, 'deliveryHour'),
      replyToEmail: formString(formData, 'replyToEmail'),
    });
    return 'Configurações salvas.';
  });
}
