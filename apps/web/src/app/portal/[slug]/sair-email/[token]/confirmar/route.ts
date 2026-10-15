import { optOutEmailByLink } from '@contab/core';
import { serverEnv } from '@contab/config/env';
import { asTenantId } from '@contab/domain';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';

/** Confirma o descadastro do e-mail (RN7): vale na hora. */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const { token } = await params;
  const tenant = await getPortalTenant();
  const ok = await optOutEmailByLink(
    asTenantId(tenant.id),
    token,
    serverEnv().BETTER_AUTH_SECRET,
    await getRequestMeta(),
  );
  return ok
    ? seeOther(`/sair-email/${token}?feito=1`)
    : new Response('Não encontrado', { status: 404 });
}
