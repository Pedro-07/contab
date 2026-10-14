/**
 * Roteamento por host (P16). Só reescreve o caminho; não decide tenant nem acesso.
 * - app.<domínio>/x      → /painel/x   (e /api/* segue direto)
 * - <slug>.<domínio>/x   → /portal/<slug>/x
 * - qualquer outro host  → 404 (o domínio puro vai para o painel)
 * Como todo caminho recebe o prefixo, /painel e /portal digitados direto viram 404.
 */
import { resolveHost } from '@contab/domain';
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const baseDomain = process.env.APP_BASE_DOMAIN ?? 'localhost:3000';
  const host = request.headers.get('host');
  const target = resolveHost(host, baseDomain);
  const { pathname, search } = request.nextUrl;

  const headers = new Headers(request.headers);
  headers.set('x-request-id', crypto.randomUUID());

  if (target.kind === 'painel') {
    if (pathname.startsWith('/api/')) return NextResponse.next({ request: { headers } });
    return NextResponse.rewrite(new URL(`/painel${pathname}${search}`, request.url), {
      request: { headers },
    });
  }

  if (target.kind === 'portal') {
    // O portal não tem API na Fundação.
    if (pathname.startsWith('/api/')) return new NextResponse(null, { status: 404 });
    return NextResponse.rewrite(
      new URL(`/portal/${target.slug}${pathname}${search}`, request.url),
      {
        request: { headers },
      },
    );
  }

  if (host?.toLowerCase() === baseDomain.toLowerCase()) {
    const url = new URL(request.url);
    url.host = `app.${baseDomain}`;
    return NextResponse.redirect(url);
  }

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
