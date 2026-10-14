'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/server/services';

/** Sair apaga a sessão no banco (revogação imediata). */
export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect('/entrar');
}
