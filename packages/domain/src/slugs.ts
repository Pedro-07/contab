/** Subdomínios que nunca podem ser de um escritório (P16). */
export const RESERVED_SLUGS = [
  'app',
  'api',
  'www',
  'admin',
  'status',
  'mail',
  'suporte',
  'staging',
  'docs',
] as const;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && !(RESERVED_SLUGS as readonly string[]).includes(slug);
}

/**
 * Lê o host da requisição e diz se é o painel, o portal de um escritório ou nada.
 * `baseDomain` vem de APP_BASE_DOMAIN (ex.: "localhost:3000" ou "contab.app").
 */
export type HostTarget =
  { kind: 'painel' } | { kind: 'portal'; slug: string } | { kind: 'desconhecido' };

export function resolveHost(host: string | null | undefined, baseDomain: string): HostTarget {
  if (!host) return { kind: 'desconhecido' };
  const h = host.toLowerCase();
  const base = baseDomain.toLowerCase();
  if (!h.endsWith(`.${base}`)) return { kind: 'desconhecido' };
  const sub = h.slice(0, -(base.length + 1));
  if (sub === 'app') return { kind: 'painel' };
  if (sub.includes('.') || !isValidSlug(sub)) return { kind: 'desconhecido' };
  return { kind: 'portal', slug: sub };
}
