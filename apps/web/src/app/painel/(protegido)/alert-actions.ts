'use server';

import { resolveTenantAlert } from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';

export async function resolveAlertAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/', async (ctx) => {
    await resolveTenantAlert(ctx, formString(formData, 'alertId'));
    return 'Alerta resolvido.';
  });
}
