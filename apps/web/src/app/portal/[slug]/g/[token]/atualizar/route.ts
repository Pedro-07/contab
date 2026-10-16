import { requestRecalcByLink } from '@contab/core';
import { asTenantId } from '@contab/domain';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant } from '@/server/portal';
import { sameOrigin, seeOther } from '@/server/portal-forms';
import { getBoss } from '@/server/services';

/**
 * "Atualizar guia" (CA2): o cliente pede o DAS vencido com os valores de hoje. O tenant vem
 * do subdomínio e a guia, do token; a Receita é chamada pelo worker e a guia nova chega
 * pelo WhatsApp ou e-mail.
 */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!(await sameOrigin())) return new Response('Origem inválida', { status: 403 });
  const { token } = await params;
  const tenant = await getPortalTenant();
  const result = await requestRecalcByLink(
    asTenantId(tenant.id),
    token,
    await getBoss(),
    await getRequestMeta(),
  );
  return seeOther(`/g/${encodeURIComponent(token)}?atualizacao=${result}`);
}
