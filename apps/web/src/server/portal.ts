/**
 * Contexto do portal (P16, incremento 2). O tenant vem só do host da requisição; a sessão
 * fica num cookie preso ao host (sem Domain), com nome diferente do cookie do painel.
 */
import { readPortalSession, type PortalState } from '@contab/core';
import { serverEnv } from '@contab/config/env';
import { findTenantBySlug, type Tenant } from '@contab/db/global';
import { asTenantId, resolveHost } from '@contab/domain';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getRequestMeta } from './painel';

function https(): boolean {
  return serverEnv().BETTER_AUTH_URL.startsWith('https://');
}

/** Em HTTPS, __Host- (preso ao host, Secure, Path=/). Em dev, http, sem o prefixo. */
export function portalCookieName(): string {
  return https() ? '__Host-portal.session' : 'portal.session';
}

export function portalCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: https(),
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Tenant do portal pelo host. Host que não é de portal, ou slug desconhecido: 404. */
export const getPortalTenant = cache(async (): Promise<Tenant> => {
  const target = resolveHost((await headers()).get('host'), serverEnv().APP_BASE_DOMAIN);
  if (target.kind !== 'portal') notFound();
  const tenant = await findTenantBySlug(target.slug);
  if (!tenant) notFound();
  return tenant;
});

export const getPortalState = cache(async (): Promise<PortalState | null> => {
  const tenant = await getPortalTenant();
  const token = (await cookies()).get(portalCookieName())?.value;
  return readPortalSession(asTenantId(tenant.id), token, await getRequestMeta());
});
