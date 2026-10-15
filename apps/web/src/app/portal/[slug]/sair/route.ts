import { signOutPortal } from '@contab/core';
import { cookies } from 'next/headers';
import { getPortalState, portalCookieName } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';

/** Revoga a sessão do portal no banco e apaga o cookie. */
export async function POST() {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const state = await getPortalState();
  if (state) await signOutPortal(state);
  (await cookies()).delete(portalCookieName());
  return seeOther('/');
}
