import { readPainelSession, resolvePainel, type PainelState, type RequestMeta } from '@contab/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './services';

/** Metadados da requisição para auditoria e log de segurança. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    requestId: h.get('x-request-id') ?? crypto.randomUUID(),
    ip: forwarded || h.get('x-real-ip') || null,
  };
}

/** Estado do painel na requisição atual (uma leitura por requisição). */
export const getPainelState = cache(async (): Promise<PainelState> => {
  const h = await headers();
  const session = await readPainelSession(getAuth(), h);
  return resolvePainel(session, await getRequestMeta());
});

export type PainelOk = Extract<PainelState, { kind: 'ok' }>;

/** Exige sessão, organização ativa e segundo fator. Redireciona quando falta algo. */
export async function requirePainel(): Promise<PainelOk> {
  const state = await getPainelState();
  if (state.kind === 'anonimo') redirect('/entrar');
  if (state.kind === 'sem_organizacao') redirect('/organizacoes');
  if (state.kind === 'mfa_pendente') redirect('/mfa');
  return state;
}
