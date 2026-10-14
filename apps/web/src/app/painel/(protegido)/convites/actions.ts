'use server';

import { createInvitation, resendInvitation, revokeInvitation } from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';
import { getBoss } from '@/server/services';

export async function createInvitationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/convites', async (ctx) => {
    await createInvitation(ctx, await getBoss(), {
      email: formString(formData, 'email'),
      role: formString(formData, 'role'),
    });
    return 'Convite criado. O e-mail sai em instantes.';
  });
}

export async function resendInvitationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/convites', async (ctx) => {
    await resendInvitation(ctx, await getBoss(), formString(formData, 'invitationId'));
    return 'Convite reenviado. O link anterior deixou de valer.';
  });
}

export async function revokeInvitationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/convites', async (ctx) => {
    await revokeInvitation(ctx, formString(formData, 'invitationId'));
    return 'Convite revogado.';
  });
}
