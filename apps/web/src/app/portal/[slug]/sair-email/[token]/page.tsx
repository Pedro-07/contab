import { getPortalTenant } from '@/server/portal';

/**
 * Descadastro do e-mail (RN7). A página só pergunta; quem desliga é o botão (POST). Assim,
 * um leitor de e-mail que abre os links sozinho não descadastra ninguém.
 */
export default async function SairEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const { feito } = await searchParams;
  const tenant = await getPortalTenant();
  if (feito === '1') {
    return (
      <main>
        <h1>{tenant.name}</h1>
        <p role="status">Pronto. Você não vai mais receber e-mails do escritório por aqui.</p>
      </main>
    );
  }
  return (
    <main>
      <h1>{tenant.name}</h1>
      <p>Quer parar de receber as guias e os avisos do escritório por e-mail?</p>
      <form method="post" action={`/sair-email/${token}/confirmar`}>
        <button type="submit">Parar de receber por e-mail</button>
      </form>
    </main>
  );
}
