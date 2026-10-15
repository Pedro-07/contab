import { getSecureLinkPdfUrl } from '@contab/core';
import { asTenantId } from '@contab/domain';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant } from '@/server/portal';
import { getStorage } from '@/server/services';

/** PDF pelo link seguro: só com o link válido, por URL de 5 min (RN14). */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await getPortalTenant();
  const url = await getSecureLinkPdfUrl(
    asTenantId(tenant.id),
    token,
    getStorage(),
    await getRequestMeta(),
  );
  if (!url) return new Response('Não encontrado', { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { location: url, 'cache-control': 'no-store' },
  });
}
