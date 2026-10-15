import { cookies } from 'next/headers';
import { getPortalTenant } from '@/server/portal';
import { LOGIN_PHONE_COOKIE } from './cookie';

/**
 * Login do portal (P3): telefone → código no WhatsApp (ou e-mail) → empresas. O telefone
 * fica num cookie curto entre os passos, nunca na URL.
 */
export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const tenant = await getPortalTenant();
  const params = await searchParams;
  const hasPhone = Boolean((await cookies()).get(LOGIN_PHONE_COOKIE)?.value);
  const codeStep = params.etapa === 'codigo' && hasPhone;

  return (
    <main>
      <h1>{tenant.name}</h1>
      {codeStep ? (
        <>
          <p role="status">
            Se o telefone estiver cadastrado no escritório, você vai receber um código pelo WhatsApp
            (ou por e-mail) em instantes.
          </p>
          {params.erro === '1' && (
            <p role="alert" className="alert">
              Código inválido ou vencido. Confira e tente de novo, ou peça outro código.
            </p>
          )}
          <form method="post" action="/entrar/verificar">
            <label htmlFor="code">Código de 6 dígitos</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
            <button type="submit">Entrar</button>
          </form>
          <p>
            <a href="/entrar">Usar outro telefone ou pedir outro código</a>
          </p>
        </>
      ) : (
        <form method="post" action="/entrar/codigo">
          <label htmlFor="phone">Seu celular (com DDD)</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="(98) 91234-5678"
          />
          <button type="submit">Receber código</button>
        </form>
      )}
    </main>
  );
}
