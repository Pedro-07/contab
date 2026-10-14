'use server';

import { readPainelSession, switchOrganization } from '@contab/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { formString, type ActionResult } from '@/server/actions';
import { getRequestMeta } from '@/server/painel';
import { getAuth } from '@/server/services';

/**
 * O tenantId do formulário é só um pedido de troca: switchOrganization confere a
 * membership e registra a tentativa negada. Ele nunca vira contexto sem essa checagem.
 */
export async function switchOrganizationAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await readPainelSession(getAuth(), await headers());
  if (!session) redirect('/entrar');
  const switched = await switchOrganization(
    session,
    formString(formData, 'tenantId'),
    await getRequestMeta(),
  );
  if (!switched) return { ok: false, error: 'Você não participa desse escritório.' };
  redirect('/');
}
