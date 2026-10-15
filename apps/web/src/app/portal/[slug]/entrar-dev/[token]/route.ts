import { PORTAL_SESSION_DAYS, portalDevLoginAllowed, redeemPortalDevLink } from '@contab/core';
import { serverEnv } from '@contab/config/env';
import { asTenantId } from '@contab/domain';
import { cookies } from 'next/headers';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant, portalCookieName, portalCookieOptions } from '@/server/portal';

/**
 * Entrada de desenvolvimento (D1): troca o link de uso único do `pnpm portal:dev-login`
 * por uma sessão. Não existe em staging nem em produção (404). Sai quando o login por
 * código no WhatsApp chegar.
 */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const appEnv = serverEnv().APP_ENV;
  if (!portalDevLoginAllowed(appEnv)) return new Response('Não encontrado', { status: 404 });
  const { token } = await params;
  const tenant = await getPortalTenant();
  const session = await redeemPortalDevLink(
    appEnv,
    asTenantId(tenant.id),
    token,
    await getRequestMeta(),
  );
  if (!session) {
    return new Response(null, { status: 303, headers: { location: '/?link=invalido' } });
  }
  (await cookies()).set(
    portalCookieName(),
    session,
    portalCookieOptions(PORTAL_SESSION_DAYS * 86_400),
  );
  return new Response(null, {
    status: 303,
    headers: { location: '/', 'cache-control': 'no-store' },
  });
}
