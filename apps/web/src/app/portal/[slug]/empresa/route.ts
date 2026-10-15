import { switchPortalCompany } from '@contab/core';
import { getPortalState } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';

/** Troca a empresa ativa. O escritório e a pessoa vêm do host e do cookie (CA6). */
export async function POST(request: Request) {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const state = await getPortalState();
  if (!state) return seeOther('/');
  const companyId = (await request.formData()).get('companyId');
  const ok = await switchPortalCompany(state, typeof companyId === 'string' ? companyId : '');
  return seeOther(ok ? '/' : '/?empresa=negada');
}
