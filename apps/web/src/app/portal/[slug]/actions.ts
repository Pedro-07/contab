'use server';

import { signOutPortal, switchPortalCompany } from '@contab/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formString } from '@/server/actions';
import { getPortalState, portalCookieName } from '@/server/portal';

// O escritório e a pessoa vêm do host e do cookie, nunca do formulário.

export async function switchCompanyAction(formData: FormData): Promise<void> {
  const state = await getPortalState();
  if (!state) redirect('/');
  const ok = await switchPortalCompany(state, formString(formData, 'companyId'));
  redirect(ok ? '/' : '/?empresa=negada');
}

export async function signOutPortalAction(): Promise<void> {
  const state = await getPortalState();
  if (state) await signOutPortal(state);
  (await cookies()).delete(portalCookieName());
  redirect('/');
}
