/**
 * Login do portal por código no WhatsApp (P3, D1 do incremento 2). O escritório vem do
 * subdomínio; o telefone precisa ser de um contato com acesso a alguma empresa. A resposta
 * nunca revela se o telefone existe. Código de 6 dígitos, 5 minutos, 5 tentativas, com
 * limite por telefone e por IP. Sem WhatsApp pronto, o código vai por e-mail, se houver.
 */
import { WhatsAppError } from '@contab/adapters/whatsapp';
import {
  countLoginCodesSince,
  findActiveLoginCode,
  findContactByPhone,
  findWhatsAppChannel,
  insertLoginCode,
  insertPortalSession,
  listAccessibleCompanies,
  listTenantTemplates,
  updateLoginCode,
  withTenant,
  type TenantContext,
} from '@contab/db';
import { recordSecurityEvent } from '@contab/db/global';
import {
  metaTemplateName,
  parsePhone,
  renderTemplate,
  TEMPLATE_LIBRARY,
  type TenantId,
} from '@contab/domain';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadConnection, tenantInfo, type DeliveryDeps } from './delivery-deps';
import { hashPortalToken, PORTAL_SESSION_DAYS, type RequestMeta } from './portal';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const PER_PHONE_15_MIN = 3;
const PER_IP_HOUR = 10;

function ctxFor(tenantId: TenantId, meta: RequestMeta): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'portal.login', jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
}

function hashCode(tenantId: string, contactId: string, code: string): string {
  return createHash('sha256').update(`${tenantId}:${contactId}:${code}`).digest('hex');
}

/** Pede o código. Sempre devolve a mesma resposta, exista ou não o telefone. */
export async function requestPortalCode(
  tenantId: TenantId,
  phoneInput: string,
  deps: Pick<DeliveryDeps, 'whatsapp' | 'email' | 'cipher'>,
  meta: RequestMeta,
): Promise<void> {
  const phone = parsePhone(phoneInput);
  if (!phone) return;
  const ctx = ctxFor(tenantId, meta);
  const sent = await withTenant(ctx, async (tx) => {
    const contact = await findContactByPhone(tx, phone);
    if (!contact || (await listAccessibleCompanies(tx, contact.id)).length === 0) return false;
    const since15 = new Date(Date.now() - 15 * 60_000);
    const sinceHour = new Date(Date.now() - 60 * 60_000);
    if ((await countLoginCodesSince(tx, { contactId: contact.id }, since15)) >= PER_PHONE_15_MIN)
      return false;
    if (meta.ip && (await countLoginCodesSince(tx, { ip: meta.ip }, sinceHour)) >= PER_IP_HOUR)
      return false;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await insertLoginCode(tx, tenantId, {
      contactId: contact.id,
      codeHash: hashCode(tenantId, contact.id, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      ip: meta.ip ?? null,
    });

    const def = TEMPLATE_LIBRARY.codigo_acesso;
    const channel = await findWhatsAppChannel(tx);
    const approved =
      channel?.status === 'ativo' &&
      (await listTenantTemplates(tx, channel.id)).some(
        (t) => t.key === 'codigo_acesso' && t.status === 'aprovado' && t.enabled,
      );
    if (channel && approved) {
      try {
        const { connection } = await loadConnection(tx, ctx, deps.cipher, channel.id);
        await deps.whatsapp.sendTemplate(connection, {
          to: phone,
          templateName: metaTemplateName(def),
          language: def.language,
          category: def.category,
          bodyValues: [code],
        });
        return true;
      } catch (error) {
        if (!(error instanceof WhatsAppError)) throw error;
      }
    }
    if (contact.email) {
      const office = await tenantInfo(ctx);
      await deps.email.send({
        to: contact.email,
        subject: def.emailSubject,
        text: `${renderTemplate(def.body, [code])}\n\nEnviado por ${office.name}.`,
        fromName: office.name,
      });
      return true;
    }
    return false;
  });
  if (!sent) {
    await recordSecurityEvent({
      type: 'login_failed',
      activeTenantId: tenantId,
      requestId: meta.requestId,
      ip: meta.ip ?? null,
      details: { motivo: 'codigo_portal_nao_enviado' },
    });
  }
}

/** Confere o código e abre a sessão do portal (token devolvido só uma vez). */
export async function verifyPortalCode(
  tenantId: TenantId,
  phoneInput: string,
  code: string,
  meta: RequestMeta,
): Promise<string | null> {
  const phone = parsePhone(phoneInput);
  const clean = code.replace(/\D/g, '');
  const ctx = ctxFor(tenantId, meta);
  const token =
    phone && clean.length === 6
      ? await withTenant(ctx, async (tx) => {
          const contact = await findContactByPhone(tx, phone);
          if (!contact) return null;
          const active = await findActiveLoginCode(tx, contact.id);
          if (!active || active.attempts >= MAX_ATTEMPTS) return null;
          const expected = Buffer.from(active.codeHash, 'hex');
          const given = Buffer.from(hashCode(tenantId, contact.id, clean), 'hex');
          if (!timingSafeEqual(expected, given)) {
            await updateLoginCode(tx, active.id, { attempts: active.attempts + 1 });
            return null;
          }
          await updateLoginCode(tx, active.id, { usedAt: new Date() });
          const sessionToken = randomBytes(32).toString('base64url');
          await insertPortalSession(tx, tenantId, {
            tokenHash: hashPortalToken(sessionToken),
            contactId: contact.id,
            activeCompanyId: null,
            expiresAt: new Date(Date.now() + PORTAL_SESSION_DAYS * 86_400_000),
          });
          return sessionToken;
        })
      : null;
  if (!token) {
    await recordSecurityEvent({
      type: 'login_failed',
      activeTenantId: tenantId,
      requestId: meta.requestId,
      ip: meta.ip ?? null,
      details: { motivo: 'codigo_portal_invalido' },
    });
  }
  return token;
}
