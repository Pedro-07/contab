/**
 * Link seguro sem login (RN14), no subdomínio do escritório: Pix, linha digitável e PDF.
 * Expira em 30 dias, ou quando a guia é paga ou substituída; tem limite de aberturas e
 * cada abertura é registrada. O tenant vem do host; link de outro escritório não existe.
 */
import type { FileStorage } from '@contab/adapters/storage';
import {
  findSecureLink,
  getCompany,
  getGuide,
  recordLinkAccess,
  recordConsent,
  getContact,
  withTenant,
  type Guide,
  type TenantContext,
} from '@contab/db';
import { recordSecurityEvent } from '@contab/db/global';
import { formatPeriod, GUIDE_TYPE_LABEL, type TenantId } from '@contab/domain';
import { timingSafeEqual } from 'node:crypto';
import { emailOptOutToken, hashLinkToken } from './deliveries';

export type LinkMeta = { requestId: string; ip?: string | null };

function systemCtx(tenantId: TenantId, meta: LinkMeta, job: string): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: job, jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
}

export type SecureLinkView =
  | { state: 'invalido' }
  | { state: 'expirado' | 'limite' }
  | { state: 'paga' | 'substituida' | 'cancelada'; companyName: string; typeLabel: string }
  | {
      state: 'ok';
      companyName: string;
      typeLabel: string;
      period: string;
      amountCents: number;
      dueDate: string;
      overdue: boolean;
      barcode: string | null;
      pixCode: string | null;
      hasPdf: boolean;
    };

/** Abre o link: confere validade e conta a abertura. */
export async function openSecureLink(
  tenantId: TenantId,
  token: string,
  meta: LinkMeta,
): Promise<SecureLinkView> {
  const ctx = systemCtx(tenantId, meta, 'portal.link');
  const view = await withTenant(ctx, async (tx): Promise<SecureLinkView> => {
    const link = await findSecureLink(tx, hashLinkToken(token));
    if (!link) return { state: 'invalido' };
    const guide: Guide = await getGuide(tx, link.itemId);
    const company = await getCompany(tx, guide.companyId);
    const base = {
      companyName: company.tradeName || company.legalName,
      typeLabel: GUIDE_TYPE_LABEL[guide.type],
    };
    if (guide.status === 'paga' || guide.status === 'substituida' || guide.status === 'cancelada')
      return { state: guide.status, ...base };
    if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) return { state: 'expirado' };
    if (link.accessCount >= link.maxAccesses) return { state: 'limite' };
    await recordLinkAccess(tx, tenantId, link.id, meta.ip ?? null);
    return {
      state: 'ok',
      ...base,
      period: formatPeriod(guide.period),
      amountCents: guide.amountCents,
      dueDate: guide.dueDate,
      overdue: guide.status === 'vencida',
      barcode: guide.barcode,
      pixCode: guide.pixCode,
      hasPdf: Boolean(guide.pdfStorageKey && guide.pdfSha256),
    };
  });
  if (view.state === 'invalido') {
    await recordSecurityEvent({
      type: 'resource_not_found',
      activeTenantId: tenantId,
      resourceType: 'secure_link',
      requestId: meta.requestId,
      ip: meta.ip ?? null,
    });
  }
  return view;
}

/** URL de 5 min do PDF, só com o link ainda válido. */
export async function getSecureLinkPdfUrl(
  tenantId: TenantId,
  token: string,
  storage: FileStorage,
  meta: LinkMeta,
): Promise<string | null> {
  return withTenant(systemCtx(tenantId, meta, 'portal.link'), async (tx) => {
    const link = await findSecureLink(tx, hashLinkToken(token));
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return null;
    if (link.accessCount > link.maxAccesses) return null;
    const guide = await getGuide(tx, link.itemId);
    if (guide.status !== 'publicada' && guide.status !== 'vencida') return null;
    if (!guide.pdfStorageKey || !guide.pdfSha256) return null;
    return storage.presignDownload(tenantId, guide.pdfStorageKey, {
      fileName: `guia-${guide.type}-${formatPeriod(guide.period).replace('/', '-')}.pdf`,
      contentType: 'application/pdf',
    });
  });
}

/** Descadastro do e-mail pelo link da mensagem (RN7): vale na hora. */
export async function optOutEmailByLink(
  tenantId: TenantId,
  token: string,
  secret: string,
  meta: LinkMeta,
): Promise<boolean> {
  const [contactId] = token.split('.');
  if (!contactId) return false;
  const expected = Buffer.from(emailOptOutToken(secret, tenantId, contactId));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return withTenant(systemCtx(tenantId, meta, 'portal.optout'), async (tx) => {
    const contact = await getContact(tx, contactId).catch(() => null);
    if (!contact) return false;
    if (contact.emailOptInAt) {
      await recordConsent(tx, tenantId, {
        contactId: contact.id,
        channel: 'email',
        optIn: false,
        source: 'cliente',
        actorUserId: null,
      });
    }
    return true;
  });
}
