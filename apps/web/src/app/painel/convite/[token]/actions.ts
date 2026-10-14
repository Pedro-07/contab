'use server';

import { acceptInvitation, InvalidInvitationError } from '@contab/core';
import { headers } from 'next/headers';
import { formString, type ActionResult } from '@/server/actions';
import { getRequestMeta } from '@/server/painel';
import { getAuth } from '@/server/services';

/**
 * Aceita o convite. O tenant vem do token (função invitation_lookup), nunca do formulário.
 * Depois envia o link mágico para o e-mail convidado.
 */
export async function acceptInvitationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { email } = await acceptInvitation(formString(formData, 'token'), await getRequestMeta());
    await getAuth().api.signInMagicLink({
      body: { email, callbackURL: '/' },
      headers: await headers(),
    });
    return { ok: true, message: `Convite aceito. Enviamos um link de acesso para ${email}.` };
  } catch (error) {
    if (error instanceof InvalidInvitationError) return { ok: false, error: error.message };
    throw error;
  }
}
