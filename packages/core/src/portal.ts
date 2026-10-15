/**
 * Portal do cliente (incremento 2, D1). O tenant vem do subdomínio; a sessão só é
 * procurada dentro dele (RLS), então uma sessão de outro escritório não existe aqui.
 * A pessoa só vê empresas com acesso vigente, e só a empresa ativa por vez (CA6).
 * O login por código no WhatsApp (P3) entra no incremento "Guias, templates e entrega";
 * até lá, só o link de desenvolvimento abre sessão.
 */
import type { FileStorage } from '@contab/adapters/storage';
import {
  findPortalSession,
  getContact,
  getDocument,
  insertPortalSession,
  listAccessibleCompanies,
  listCompanyDocuments,
  NotFoundError,
  revokePortalSession,
  setPortalActiveCompany,
  withTenant,
  type PortalCompany,
  type TenantContext,
} from '@contab/db';
import { recordSecurityEvent } from '@contab/db/global';
import type { TenantId } from '@contab/domain';
import { createHash, randomBytes } from 'node:crypto';
import { uuidOrNotFound } from './clients';
import { logNotFound } from './guard';

export const PORTAL_SESSION_DAYS = 7;
/** Link de entrada de desenvolvimento: uso único, 10 minutos. */
export const PORTAL_DEV_LINK_MINUTES = 10;

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashPortalToken(token) };
}

export type RequestMeta = { requestId: string; ip?: string | null };

function lookupContext(tenantId: TenantId, meta: RequestMeta): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'portal.sessao', jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
}

function contactContext(tenantId: TenantId, contactId: string, meta: RequestMeta): TenantContext {
  return {
    tenantId,
    actor: { type: 'contact', contactId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
}

/** O link de desenvolvimento só existe em development e test (D1, risco da seção 10). */
export function portalDevLoginAllowed(appEnv: string): boolean {
  return appEnv === 'development' || appEnv === 'test';
}

/**
 * Cria um link de entrada de uso único para o contato do telefone dado. Só para
 * desenvolvimento e testes (pnpm portal:dev-login).
 */
export async function createPortalDevLink(
  appEnv: string,
  tenantId: TenantId,
  contactId: string,
  meta: RequestMeta,
): Promise<string> {
  if (!portalDevLoginAllowed(appEnv)) throw new Error('Entrada de desenvolvimento desativada.');
  const { token, hash } = newToken();
  await withTenant(lookupContext(tenantId, meta), async (tx) => {
    const contact = await getContact(tx, contactId);
    await insertPortalSession(tx, tenantId, {
      tokenHash: hash,
      contactId: contact.id,
      activeCompanyId: null,
      expiresAt: new Date(Date.now() + PORTAL_DEV_LINK_MINUTES * 60_000),
    });
  });
  return token;
}

/**
 * Troca o link de uso único por uma sessão nova de 7 dias. O token do link nunca vira
 * o token da sessão (ele passou pela URL).
 */
export async function redeemPortalDevLink(
  appEnv: string,
  tenantId: TenantId,
  linkToken: string,
  meta: RequestMeta,
): Promise<string | null> {
  if (!portalDevLoginAllowed(appEnv)) return null;
  const ctx = lookupContext(tenantId, meta);
  const session = await withTenant(ctx, async (tx) => {
    const link = await findPortalSession(tx, hashPortalToken(linkToken));
    if (!link) return null;
    await revokePortalSession(tx, link.id);
    const { token, hash } = newToken();
    await insertPortalSession(tx, tenantId, {
      tokenHash: hash,
      contactId: link.contactId,
      activeCompanyId: null,
      expiresAt: new Date(Date.now() + PORTAL_SESSION_DAYS * 86_400_000),
    });
    return token;
  });
  if (!session) {
    await recordSecurityEvent({
      type: 'login_failed',
      activeTenantId: tenantId,
      requestId: meta.requestId,
      ip: meta.ip ?? null,
      details: { motivo: 'link_portal_invalido' },
    });
  }
  return session;
}

export type PortalState = {
  ctx: TenantContext;
  sessionId: string;
  contactName: string;
  companies: PortalCompany[];
  activeCompany: PortalCompany | null;
};

/**
 * Lê a sessão do portal no tenant do subdomínio. A empresa ativa só vale se o acesso
 * ainda existir; se só houver uma empresa, ela é escolhida sozinha.
 */
export async function readPortalSession(
  tenantId: TenantId,
  token: string | undefined,
  meta: RequestMeta,
): Promise<PortalState | null> {
  if (!token) return null;
  return withTenant(lookupContext(tenantId, meta), async (tx) => {
    const session = await findPortalSession(tx, hashPortalToken(token));
    if (!session) return null;
    const contact = await getContact(tx, session.contactId).catch(() => null);
    if (!contact) return null;
    const companies = await listAccessibleCompanies(tx, contact.id);
    let active = companies.find((c) => c.companyId === session.activeCompanyId) ?? null;
    if (!active && companies.length === 1) active = companies[0]!;
    if ((active?.companyId ?? null) !== session.activeCompanyId) {
      await setPortalActiveCompany(tx, session.id, active?.companyId ?? null);
    }
    return {
      ctx: contactContext(tenantId, contact.id, meta),
      sessionId: session.id,
      contactName: contact.name,
      companies,
      activeCompany: active,
    };
  });
}

/** Troca a empresa ativa. Empresa sem acesso vigente: negado e registrado. */
export async function switchPortalCompany(state: PortalState, companyId: string): Promise<boolean> {
  const allowed = state.companies.some((c) => c.companyId === companyId);
  if (!allowed) {
    await recordSecurityEvent({
      type: 'forbidden',
      activeTenantId: state.ctx.tenantId,
      resourceType: 'client_company',
      resourceId: companyId,
      requestId: state.ctx.requestId,
      ip: state.ctx.ip ?? null,
      details: { motivo: 'portal_empresa_sem_acesso' },
    });
    return false;
  }
  await withTenant(state.ctx, (tx) => setPortalActiveCompany(tx, state.sessionId, companyId));
  return true;
}

export async function signOutPortal(state: PortalState): Promise<void> {
  await withTenant(state.ctx, (tx) => revokePortalSession(tx, state.sessionId));
}

/** Documentos visíveis e disponíveis da empresa ativa. Sem empresa ativa, nada. */
export async function listPortalDocuments(state: PortalState) {
  const company = state.activeCompany;
  if (!company) return [];
  return withTenant(state.ctx, (tx) =>
    listCompanyDocuments(tx, company.companyId, { onlyVisibleToClient: true }),
  );
}

/**
 * URL de download (5 min) de um documento da empresa ativa. Documento de outra empresa,
 * mesmo do mesmo escritório, é 404 e fica registrado (CA6).
 */
export async function getPortalDocumentDownloadUrl(
  state: PortalState,
  storage: FileStorage,
  documentId: string,
): Promise<string> {
  return logNotFound(state.ctx, () =>
    withTenant(state.ctx, async (tx) => {
      const id = uuidOrNotFound(documentId, 'document');
      const company = state.activeCompany;
      if (!company) throw new NotFoundError('document', id);
      const doc = await getDocument(tx, id);
      if (doc.companyId !== company.companyId || !doc.visibleToClient)
        throw new NotFoundError('document', id);
      const full = (
        await listCompanyDocuments(tx, company.companyId, { onlyVisibleToClient: true })
      ).find((d) => d.id === doc.id);
      if (!full?.current) throw new NotFoundError('document', id);
      return storage.presignDownload(state.ctx.tenantId, full.current.storageKey, {
        fileName: full.current.originalName,
        contentType: full.current.contentType,
      });
    }),
  );
}
