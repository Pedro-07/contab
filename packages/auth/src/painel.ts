/**
 * Trava do painel (app.<domínio>). O tenant vem SEMPRE da sessão guardada no banco e da
 * membership conferida a cada requisição. Nenhum tenant_id do navegador é aceito.
 */
import {
  asTenantId,
  asUserId,
  roleRequiresMfa,
  type Role,
  type TenantId,
  type UserId,
} from '@contab/domain';
import { listMyOrganizations, withUser, type MyOrganization, type TenantContext } from '@contab/db';
import { recordSecurityEvent, setSessionActiveTenant } from '@contab/db/global';
import type { Auth } from './auth';

export type PainelSession = {
  sessionId: string;
  userId: UserId;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  activeTenantId: string | null;
  mfaVerifiedAt: Date | null;
};

export type PainelState =
  | { kind: 'anonimo' }
  | { kind: 'sem_organizacao'; session: PainelSession; organizations: MyOrganization[] }
  | {
      kind: 'mfa_pendente';
      session: PainelSession;
      organization: MyOrganization;
      needsSetup: boolean;
    }
  | { kind: 'ok'; session: PainelSession; organization: MyOrganization; ctx: TenantContext };

export type RequestMeta = { requestId: string; ip: string | null };

/** Lê a sessão do Better Auth e devolve só o que o painel usa. */
export async function readPainelSession(
  auth: Auth,
  headers: Headers,
): Promise<PainelSession | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  const s = result.session as typeof result.session & {
    activeTenantId?: string | null;
    mfaVerifiedAt?: Date | null;
  };
  const u = result.user as typeof result.user & { twoFactorEnabled?: boolean | null };
  return {
    sessionId: s.id,
    userId: asUserId(u.id),
    email: u.email,
    name: u.name,
    twoFactorEnabled: !!u.twoFactorEnabled,
    activeTenantId: s.activeTenantId ?? null,
    mfaVerifiedAt: s.mfaVerifiedAt ? new Date(s.mfaVerifiedAt) : null,
  };
}

/** MFA exigido pelo papel (dono, admin) ou porque a pessoa ativou o TOTP por conta própria. */
export function mfaRequired(role: Role, twoFactorEnabled: boolean): boolean {
  return roleRequiresMfa(role) || twoFactorEnabled;
}

/**
 * Decide o estado do painel a partir da sessão. Passos:
 * 1. sem sessão: anônimo;
 * 2. organização ativa da sessão; sem ela, escolhe sozinha se houver só uma;
 * 3. confere a membership ativa (a organização some se a pessoa foi removida);
 * 4. exige o segundo fator quando o papel pede.
 */
export async function resolvePainel(
  session: PainelSession | null,
  meta: RequestMeta,
): Promise<PainelState> {
  if (!session) return { kind: 'anonimo' };

  const organizations = await withUser(session.userId, (tx) =>
    listMyOrganizations(tx, session.userId),
  );
  let organization = organizations.find((o) => o.tenantId === session.activeTenantId);

  if (!organization) {
    if (session.activeTenantId) {
      // A organização ativa deixou de valer (membership removida): limpa a sessão.
      await setSessionActiveTenant(session.sessionId, null);
    }
    if (organizations.length !== 1) return { kind: 'sem_organizacao', session, organizations };
    organization = organizations[0]!;
    await setSessionActiveTenant(session.sessionId, organization.tenantId);
  }

  if (mfaRequired(organization.role, session.twoFactorEnabled) && !session.mfaVerifiedAt) {
    return { kind: 'mfa_pendente', session, organization, needsSetup: !session.twoFactorEnabled };
  }

  return {
    kind: 'ok',
    session,
    organization,
    ctx: {
      tenantId: organization.tenantId,
      actor: { type: 'member', userId: session.userId, role: organization.role },
      requestId: meta.requestId,
      ip: meta.ip,
    },
  };
}

/**
 * Troca a organização ativa. O ID escolhido é só um pedido: o servidor confere a
 * membership e registra a tentativa negada em security_events.
 */
export async function switchOrganization(
  session: PainelSession,
  requestedTenantId: string,
  meta: RequestMeta,
): Promise<boolean> {
  let tenantId: TenantId;
  try {
    tenantId = asTenantId(requestedTenantId);
  } catch {
    tenantId = '' as TenantId;
  }
  const organizations = await withUser(session.userId, (tx) =>
    listMyOrganizations(tx, session.userId),
  );
  if (!tenantId || !organizations.some((o) => o.tenantId === tenantId)) {
    await recordSecurityEvent({
      type: 'tenant_switch_denied',
      userId: session.userId,
      activeTenantId: session.activeTenantId,
      resourceType: 'tenant',
      resourceId: String(requestedTenantId),
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return false;
  }
  await setSessionActiveTenant(session.sessionId, tenantId);
  return true;
}
