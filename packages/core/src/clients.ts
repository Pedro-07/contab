/**
 * Empresas-clientes e contatos (incremento 2). O tenant vem sempre do contexto; os
 * formulários só trazem IDs e campos. Permissões (D3): todos veem; dono, admin e
 * contador alteram.
 */
import {
  findContactByEmail,
  findContactByPhone,
  getCompany,
  getContact,
  grantPortalAccess,
  insertCompany,
  insertContact,
  linkContact,
  listCompanies,
  listCompanyContacts,
  listCompanyDocuments,
  listContactCompanies,
  listContactConsents,
  recordAudit,
  recordConsent,
  revokePortalAccess,
  unlinkContact,
  updateCompany,
  updateContact,
  withTenant,
  findCompanyByCnpj,
  NotFoundError,
  type Company,
  type CompanyFilter,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import {
  canEditClients,
  canViewClients,
  COMPANY_STATUSES,
  CONSENT_CHANNELS,
  CONTACT_ROLES,
  isOneOf,
  isUuid,
  parseCnpj,
  parsePhone,
  POA_STATUSES,
  PREFERRED_CHANNELS,
  TAX_REGIMES,
  type ConsentSource,
  type UserId,
} from '@contab/domain';
import { z } from 'zod';
import { actorRole, actorUserId, deny, logNotFound } from './guard';

/** Erro de validação com mensagem segura para mostrar. */
export class ClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientInputError';
  }
}

const DENIED = 'Seu papel não permite alterar clientes.';

async function requireViewer(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canViewClients(role)) await deny(ctx, 'Sem acesso aos clientes.', 'client_company');
}

export async function requireClientEditor(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canEditClients(role)) await deny(ctx, DENIED, 'client_company');
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ClientInputError(result.error.issues[0]?.message ?? 'Dados inválidos.');
  }
  return result.data;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((v) => v || null)
    .nullish();

const companySchema = z.object({
  cnpj: z.string().transform((v, c) => {
    const cnpj = parseCnpj(v);
    if (!cnpj) c.addIssue({ code: 'custom', message: 'CNPJ inválido.' });
    return cnpj ?? '';
  }),
  legalName: z.string().trim().min(2, 'Informe a razão social.').max(200),
  tradeName: optionalText(200),
  regime: z.enum(TAX_REGIMES, { message: 'Escolha o regime tributário.' }),
  stateRegistration: optionalText(30),
  municipalRegistration: optionalText(30),
  poaStatus: z.enum(POA_STATUSES).optional(),
  poaValidUntil: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data da procuração inválida.')
    .nullish(),
  notes: optionalText(2000),
});

export type CompanyFormInput = z.input<typeof companySchema>;

export async function listClientCompanies(ctx: TenantContext, filter: CompanyFilter = {}) {
  await requireViewer(ctx);
  return withTenant(ctx, (tx) => listCompanies(tx, filter));
}

export async function getCompanyProfile(ctx: TenantContext, companyId: string) {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const contacts = await listCompanyContacts(tx, company.id);
      const documents = await listCompanyDocuments(tx, company.id);
      return { company, contacts, documents };
    }),
  );
}

/** ID que não é UUID nem chega ao banco: vira o mesmo 404 de um ID inexistente. */
export function uuidOrNotFound(id: string, resourceType: string): string {
  if (!isUuid(id)) throw new NotFoundError(resourceType, id);
  return id;
}

export async function createCompany(ctx: TenantContext, input: CompanyFormInput): Promise<Company> {
  await requireClientEditor(ctx);
  const data = parse(companySchema, input);
  return withTenant(ctx, async (tx) => {
    if (await findCompanyByCnpj(tx, data.cnpj)) {
      throw new ClientInputError('Já existe uma empresa com este CNPJ.');
    }
    const company = await insertCompany(tx, ctx.tenantId, data);
    await recordAudit(tx, ctx, {
      action: 'empresa.criada',
      resourceType: 'client_company',
      resourceId: company.id,
      metadata: { regime: company.regime },
    });
    return company;
  });
}

export async function editCompany(
  ctx: TenantContext,
  companyId: string,
  input: CompanyFormInput,
): Promise<void> {
  await requireClientEditor(ctx);
  const data = parse(companySchema, input);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const current = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const sameCnpj = await findCompanyByCnpj(tx, data.cnpj);
      if (sameCnpj && sameCnpj.id !== current.id) {
        throw new ClientInputError('Já existe uma empresa com este CNPJ.');
      }
      await updateCompany(tx, current.id, data);
      await recordAudit(tx, ctx, {
        action: 'empresa.atualizada',
        resourceType: 'client_company',
        resourceId: current.id,
      });
    }),
  );
}

export async function setCompanyStatus(
  ctx: TenantContext,
  companyId: string,
  status: string,
): Promise<void> {
  await requireClientEditor(ctx);
  if (!isOneOf(COMPANY_STATUSES, status)) throw new ClientInputError('Status inválido.');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      await updateCompany(tx, company.id, { status });
      await recordAudit(tx, ctx, {
        action: 'empresa.status_alterado',
        resourceType: 'client_company',
        resourceId: company.id,
        metadata: { de: company.status, para: status },
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

const yes = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'on' || v === 'true' || v === 'sim')
  .optional()
  .default(false);

/** Sim, não ou "não informado" (P25: não informado vale o padrão). */
const maybe = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v): boolean | undefined => {
    if (v === undefined || v === '') return undefined;
    if (v === true || v === 'on' || v === 'true' || v === 'sim') return true;
    return false;
  });

const contactSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do contato.').max(200),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((v, c) => {
        if (!v) return null;
        const phone = parsePhone(v);
        if (!phone) c.addIssue({ code: 'custom', message: 'Telefone inválido.' });
        return phone;
      }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido.'),
    preferredChannel: z.enum(PREFERRED_CHANNELS).optional().default('whatsapp'),
    role: z.enum(CONTACT_ROLES).optional().default('outro'),
    receivesDeliveries: yes,
    portalAccess: yes,
    whatsappOptIn: maybe,
    emailOptIn: maybe,
  })
  .refine((c) => c.phone || c.email, 'Informe telefone ou e-mail.');

export type ContactFormInput = z.input<typeof contactSchema>;
export type ContactData = z.output<typeof contactSchema>;

/**
 * Acha o contato pelo telefone (ou pelo e-mail, sem telefone) ou cria. Usado pelo
 * cadastro manual e pela importação.
 */
export async function upsertContactRecord(
  tx: TenantTx,
  ctx: TenantContext,
  data: Pick<ContactData, 'name' | 'phone' | 'email' | 'preferredChannel'>,
): Promise<{ id: string; created: boolean }> {
  const existing =
    (data.phone ? await findContactByPhone(tx, data.phone) : null) ??
    (!data.phone && data.email ? await findContactByEmail(tx, data.email) : null);
  if (existing) {
    await updateContact(tx, existing.id, {
      name: data.name,
      email: data.email ?? existing.email,
      preferredChannel: data.preferredChannel,
    });
    return { id: existing.id, created: false };
  }
  const created = await insertContact(tx, ctx.tenantId, {
    name: data.name,
    phone: data.phone,
    email: data.email,
    preferredChannel: data.preferredChannel,
  });
  return { id: created.id, created: true };
}

/**
 * Autorização para receber mensagens (P25). O contato novo nasce autorizado em cada canal
 * que tem (origem padrao_escritorio). Valor informado (sim ou não) é registrado com a
 * origem dada. Um opt-out feito pelo próprio cliente nunca é desfeito pelo escritório.
 */
export async function applyConsents(
  tx: TenantTx,
  ctx: TenantContext,
  contact: { id: string; created: boolean },
  wanted: { whatsapp: boolean | undefined; email: boolean | undefined; source: ConsentSource },
): Promise<number> {
  const current = await getContact(tx, contact.id);
  const history = await listContactConsents(tx, contact.id);
  const actor = actorUserId(ctx) as UserId | null;
  let optIns = 0;
  for (const channel of ['whatsapp', 'email'] as const) {
    const hasAddress = channel === 'whatsapp' ? Boolean(current.phone) : Boolean(current.email);
    if (!hasAddress) continue;
    const explicit = wanted[channel];
    const desired = explicit ?? (contact.created ? true : undefined);
    if (desired === undefined) continue;
    const isOn = Boolean(channel === 'whatsapp' ? current.whatsappOptInAt : current.emailOptInAt);
    if (desired === isOn) continue;
    const last = history.find((h) => h.channel === channel);
    if (desired && last?.status === 'opt_out' && last.source === 'cliente') continue;
    await recordConsent(tx, ctx.tenantId, {
      contactId: contact.id,
      channel,
      optIn: desired,
      source: explicit === undefined ? 'padrao_escritorio' : wanted.source,
      actorUserId: actor,
    });
    if (desired) optIns++;
  }
  return optIns;
}

export async function addContactToCompany(
  ctx: TenantContext,
  companyId: string,
  input: ContactFormInput,
): Promise<void> {
  await requireClientEditor(ctx);
  const data = parse(contactSchema, input);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const contact = await upsertContactRecord(tx, ctx, data);
      await linkContact(tx, ctx.tenantId, {
        companyId: company.id,
        contactId: contact.id,
        role: data.role,
        receivesDeliveries: data.receivesDeliveries,
      });
      const actor = actorUserId(ctx) as UserId | null;
      await applyConsents(tx, ctx, contact, {
        whatsapp: data.whatsappOptIn,
        email: data.emailOptIn,
        source: 'cadastro_manual',
      });
      if (data.portalAccess) {
        await grantPortalAccess(tx, ctx.tenantId, {
          contactId: contact.id,
          companyId: company.id,
          grantedByUserId: actor,
        });
      }
      await recordAudit(tx, ctx, {
        action: 'contato.vinculado',
        resourceType: 'contact',
        resourceId: contact.id,
        metadata: { empresa: company.id, papel: data.role, novo: contact.created },
      });
    }),
  );
}

export async function removeContactFromCompany(
  ctx: TenantContext,
  companyId: string,
  contactId: string,
): Promise<void> {
  await requireClientEditor(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const contact = await getContact(tx, uuidOrNotFound(contactId, 'contact'));
      await unlinkContact(tx, company.id, contact.id);
      // Sem vínculo, sem portal daquela empresa.
      await revokePortalAccess(tx, contact.id, company.id);
      await recordAudit(tx, ctx, {
        action: 'contato.desvinculado',
        resourceType: 'contact',
        resourceId: contact.id,
        metadata: { empresa: company.id },
      });
    }),
  );
}

export async function setContactConsent(
  ctx: TenantContext,
  contactId: string,
  channel: string,
  optIn: boolean,
): Promise<void> {
  await requireClientEditor(ctx);
  if (!isOneOf(CONSENT_CHANNELS, channel)) throw new ClientInputError('Canal inválido.');
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const contact = await getContact(tx, uuidOrNotFound(contactId, 'contact'));
      if (optIn && channel === 'whatsapp' && !contact.phone)
        throw new ClientInputError('O contato não tem telefone.');
      if (optIn && channel === 'email' && !contact.email)
        throw new ClientInputError('O contato não tem e-mail.');
      await recordConsent(tx, ctx.tenantId, {
        contactId: contact.id,
        channel,
        optIn,
        source: 'cadastro_manual',
        actorUserId: actorUserId(ctx) as UserId | null,
      });
      await recordAudit(tx, ctx, {
        action: optIn ? 'consentimento.opt_in' : 'consentimento.opt_out',
        resourceType: 'contact',
        resourceId: contact.id,
        metadata: { canal: channel },
      });
    }),
  );
}

export async function setPortalAccess(
  ctx: TenantContext,
  companyId: string,
  contactId: string,
  grant: boolean,
): Promise<void> {
  await requireClientEditor(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const company = await getCompany(tx, uuidOrNotFound(companyId, 'client_company'));
      const contact = await getContact(tx, uuidOrNotFound(contactId, 'contact'));
      const linked = (await listContactCompanies(tx, contact.id)).some(
        (c) => c.companyId === company.id,
      );
      if (grant && !linked) throw new ClientInputError('O contato não está ligado a esta empresa.');
      if (grant) {
        await grantPortalAccess(tx, ctx.tenantId, {
          contactId: contact.id,
          companyId: company.id,
          grantedByUserId: actorUserId(ctx) as UserId | null,
        });
      } else {
        await revokePortalAccess(tx, contact.id, company.id);
      }
      await recordAudit(tx, ctx, {
        action: grant ? 'portal.acesso_concedido' : 'portal.acesso_revogado',
        resourceType: 'contact',
        resourceId: contact.id,
        metadata: { empresa: company.id },
      });
    }),
  );
}

export async function getContactProfile(ctx: TenantContext, contactId: string) {
  await requireViewer(ctx);
  return logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const contact = await getContact(tx, uuidOrNotFound(contactId, 'contact'));
      const companies = await listContactCompanies(tx, contact.id);
      const consents = await listContactConsents(tx, contact.id);
      return { contact, companies, consents };
    }),
  );
}
