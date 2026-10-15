import { requestPortalCode } from '@contab/core';
import { asTenantId, parsePhone } from '@contab/domain';
import { cookies } from 'next/headers';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant, portalCookieOptions } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';
import { getDeliveryDeps } from '@/server/services';
import { LOGIN_PHONE_COOKIE, LOGIN_PHONE_MAX_AGE } from '../cookie';

/** Pede o código. A resposta é sempre a mesma, exista ou não o telefone. */
export async function POST(request: Request) {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const tenant = await getPortalTenant();
  const raw = (await request.formData()).get('phone');
  const phone = typeof raw === 'string' ? parsePhone(raw) : null;
  if (!phone) return seeOther('/entrar');
  await requestPortalCode(
    asTenantId(tenant.id),
    phone,
    await getDeliveryDeps(),
    await getRequestMeta(),
  );
  (await cookies()).set(LOGIN_PHONE_COOKIE, phone, portalCookieOptions(LOGIN_PHONE_MAX_AGE));
  return seeOther('/entrar?etapa=codigo');
}
