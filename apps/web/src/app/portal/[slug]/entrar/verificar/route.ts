import { PORTAL_SESSION_DAYS, verifyPortalCode } from '@contab/core';
import { asTenantId } from '@contab/domain';
import { cookies } from 'next/headers';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant, portalCookieName, portalCookieOptions } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';
import { LOGIN_PHONE_COOKIE } from '../cookie';

/** Confere o código e abre a sessão do portal, presa a este subdomínio. */
export async function POST(request: Request) {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const tenant = await getPortalTenant();
  const jar = await cookies();
  const phone = jar.get(LOGIN_PHONE_COOKIE)?.value;
  const raw = (await request.formData()).get('code');
  if (!phone || typeof raw !== 'string') return seeOther('/entrar');
  const token = await verifyPortalCode(asTenantId(tenant.id), phone, raw, await getRequestMeta());
  if (!token) return seeOther('/entrar?etapa=codigo&erro=1');
  jar.delete(LOGIN_PHONE_COOKIE);
  jar.set(portalCookieName(), token, portalCookieOptions(PORTAL_SESSION_DAYS * 86_400));
  return seeOther('/');
}
