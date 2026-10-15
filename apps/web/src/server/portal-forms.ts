/**
 * Formulários do portal tratados por rotas comuns (POST → 303), e não por server actions:
 * no build de produção, o redirect de uma server action faz o Next buscar a página de
 * destino por conta própria, e ele monta essa busca com o host do painel, não o do
 * portal. Com o 303, quem navega é o navegador, sempre no host do portal.
 */
import { headers } from 'next/headers';

export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

/**
 * Defesa extra contra CSRF, além do cookie SameSite=Lax: o formulário precisa vir do
 * próprio host do portal. Com `Referrer-Policy: no-referrer`, o navegador manda
 * `Origin: null` até em formulário do mesmo site; por isso vale primeiro o
 * `Sec-Fetch-Site`, que os navegadores atuais sempre enviam.
 */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const site = h.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = h.get('origin');
  const host = h.get('host');
  if (!origin || origin === 'null' || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
