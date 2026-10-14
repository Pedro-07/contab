import { findTenantBySlug } from '@contab/db/global';
import { isValidSlug } from '@contab/domain';
import { notFound } from 'next/navigation';

/**
 * Portal provisório (Fundação): só prova a resolução do tenant pelo subdomínio.
 * O slug chega pelo proxy, que o tira do host; slug reservado ou desconhecido é 404.
 */
export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const tenant = await findTenantBySlug(slug);
  if (!tenant) notFound();

  return (
    <main>
      <h1>{tenant.name}</h1>
      <p>O portal do cliente chega em um próximo incremento.</p>
    </main>
  );
}
