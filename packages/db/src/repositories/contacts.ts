import type {
  ConsentChannel,
  ConsentSource,
  ContactRole,
  PreferredChannel,
  TenantId,
  UserId,
} from '@contab/domain';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import {
  clientAccess,
  clientCompanies,
  companyContacts,
  contactConsents,
  contacts,
} from '../schema';
import type { TenantTx } from '../tenant';

export type Contact = typeof contacts.$inferSelect;

export type ContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  preferredChannel?: PreferredChannel;
};

const activeContact = isNull(contacts.deletedAt);

export async function getContact(tx: TenantTx, contactId: string): Promise<Contact> {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), activeContact));
  if (!row) throw new NotFoundError('contact', contactId);
  return row;
}

export async function findContactByPhone(tx: TenantTx, phone: string): Promise<Contact | null> {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.phone, phone), activeContact));
  return row ?? null;
}

export async function findContactByEmail(tx: TenantTx, email: string): Promise<Contact | null> {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(and(eq(sql`lower(${contacts.email})`, email.toLowerCase()), activeContact))
    .orderBy(asc(contacts.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertContact(
  tx: TenantTx,
  tenantId: TenantId,
  input: ContactInput,
): Promise<Contact> {
  const [row] = await tx
    .insert(contacts)
    .values({ tenantId, id: uuidv7(), ...input })
    .returning();
  return row!;
}

export async function updateContact(
  tx: TenantTx,
  contactId: string,
  patch: Partial<ContactInput>,
): Promise<Contact> {
  const [row] = await tx
    .update(contacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), activeContact))
    .returning();
  if (!row) throw new NotFoundError('contact', contactId);
  return row;
}

// ---------------------------------------------------------------------------
// Vínculo contato ↔ empresa
// ---------------------------------------------------------------------------

export type CompanyContact = {
  linkId: string;
  contactId: string;
  name: string;
  phone: string | null;
  email: string | null;
  preferredChannel: PreferredChannel;
  whatsappOptInAt: Date | null;
  emailOptInAt: Date | null;
  role: ContactRole;
  receivesDeliveries: boolean;
  portalAccess: boolean;
};

export async function listCompanyContacts(
  tx: TenantTx,
  companyId: string,
): Promise<CompanyContact[]> {
  return tx
    .select({
      linkId: companyContacts.id,
      contactId: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      preferredChannel: contacts.preferredChannel,
      whatsappOptInAt: contacts.whatsappOptInAt,
      emailOptInAt: contacts.emailOptInAt,
      role: companyContacts.role,
      receivesDeliveries: companyContacts.receivesDeliveries,
      portalAccess: sql<boolean>`${clientAccess.id} is not null and ${clientAccess.revokedAt} is null`,
    })
    .from(companyContacts)
    .innerJoin(
      contacts,
      and(
        eq(contacts.tenantId, companyContacts.tenantId),
        eq(contacts.id, companyContacts.contactId),
      ),
    )
    .leftJoin(
      clientAccess,
      and(
        eq(clientAccess.tenantId, companyContacts.tenantId),
        eq(clientAccess.contactId, companyContacts.contactId),
        eq(clientAccess.companyId, companyContacts.companyId),
      ),
    )
    .where(
      and(
        eq(companyContacts.companyId, companyId),
        isNull(companyContacts.deletedAt),
        activeContact,
      ),
    )
    .orderBy(asc(contacts.name));
}

export type ContactCompany = {
  companyId: string;
  legalName: string;
  cnpj: string;
  role: ContactRole;
};

export async function listContactCompanies(
  tx: TenantTx,
  contactId: string,
): Promise<ContactCompany[]> {
  return tx
    .select({
      companyId: clientCompanies.id,
      legalName: clientCompanies.legalName,
      cnpj: clientCompanies.cnpj,
      role: companyContacts.role,
    })
    .from(companyContacts)
    .innerJoin(
      clientCompanies,
      and(
        eq(clientCompanies.tenantId, companyContacts.tenantId),
        eq(clientCompanies.id, companyContacts.companyId),
      ),
    )
    .where(
      and(
        eq(companyContacts.contactId, contactId),
        isNull(companyContacts.deletedAt),
        isNull(clientCompanies.deletedAt),
      ),
    )
    .orderBy(asc(clientCompanies.legalName));
}

/** Cria o vínculo ou reativa o mesmo (a chave é única sem filtro). */
export async function linkContact(
  tx: TenantTx,
  tenantId: TenantId,
  input: { companyId: string; contactId: string; role: ContactRole; receivesDeliveries: boolean },
): Promise<void> {
  await tx
    .insert(companyContacts)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoUpdate({
      target: [companyContacts.tenantId, companyContacts.companyId, companyContacts.contactId],
      set: {
        role: input.role,
        receivesDeliveries: input.receivesDeliveries,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
}

export async function unlinkContact(
  tx: TenantTx,
  companyId: string,
  contactId: string,
): Promise<void> {
  const rows = await tx
    .update(companyContacts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(companyContacts.companyId, companyId),
        eq(companyContacts.contactId, contactId),
        isNull(companyContacts.deletedAt),
      ),
    )
    .returning({ id: companyContacts.id });
  if (rows.length === 0) throw new NotFoundError('company_contact', `${companyId}:${contactId}`);
}

// ---------------------------------------------------------------------------
// Consentimento (RN7)
// ---------------------------------------------------------------------------

export async function recordConsent(
  tx: TenantTx,
  tenantId: TenantId,
  input: {
    contactId: string;
    channel: ConsentChannel;
    optIn: boolean;
    source: ConsentSource;
    actorUserId: UserId | null;
  },
): Promise<void> {
  const now = new Date();
  await tx.insert(contactConsents).values({
    tenantId,
    id: uuidv7(),
    contactId: input.contactId,
    channel: input.channel,
    status: input.optIn ? 'opt_in' : 'opt_out',
    source: input.source,
    actorUserId: input.actorUserId,
    occurredAt: now,
  });
  const value = input.optIn ? now : null;
  await updateContactConsentSummary(tx, input.contactId, input.channel, value);
}

async function updateContactConsentSummary(
  tx: TenantTx,
  contactId: string,
  channel: ConsentChannel,
  value: Date | null,
): Promise<void> {
  const set = channel === 'whatsapp' ? { whatsappOptInAt: value } : { emailOptInAt: value };
  await tx
    .update(contacts)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
}

export async function listContactConsents(tx: TenantTx, contactId: string) {
  return tx
    .select()
    .from(contactConsents)
    .where(eq(contactConsents.contactId, contactId))
    .orderBy(desc(contactConsents.occurredAt));
}

// ---------------------------------------------------------------------------
// Acesso ao portal (RN9)
// ---------------------------------------------------------------------------

export async function grantPortalAccess(
  tx: TenantTx,
  tenantId: TenantId,
  input: { contactId: string; companyId: string; grantedByUserId: UserId | null },
): Promise<void> {
  await tx
    .insert(clientAccess)
    .values({ tenantId, id: uuidv7(), ...input })
    .onConflictDoUpdate({
      target: [clientAccess.tenantId, clientAccess.contactId, clientAccess.companyId],
      set: { revokedAt: null, grantedByUserId: input.grantedByUserId },
    });
}

export async function revokePortalAccess(
  tx: TenantTx,
  contactId: string,
  companyId: string,
): Promise<void> {
  await tx
    .update(clientAccess)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(clientAccess.contactId, contactId),
        eq(clientAccess.companyId, companyId),
        isNull(clientAccess.revokedAt),
      ),
    );
}

export type PortalCompany = {
  companyId: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
};

/** Empresas que o contato acessa no portal: acesso vigente e empresa ativa. */
export async function listAccessibleCompanies(
  tx: TenantTx,
  contactId: string,
): Promise<PortalCompany[]> {
  return tx
    .select({
      companyId: clientCompanies.id,
      legalName: clientCompanies.legalName,
      tradeName: clientCompanies.tradeName,
      cnpj: clientCompanies.cnpj,
    })
    .from(clientAccess)
    .innerJoin(
      clientCompanies,
      and(
        eq(clientCompanies.tenantId, clientAccess.tenantId),
        eq(clientCompanies.id, clientAccess.companyId),
      ),
    )
    .where(
      and(
        eq(clientAccess.contactId, contactId),
        isNull(clientAccess.revokedAt),
        isNull(clientCompanies.deletedAt),
        eq(clientCompanies.status, 'ativa'),
      ),
    )
    .orderBy(asc(clientCompanies.legalName));
}

export async function hasPortalAccess(
  tx: TenantTx,
  contactId: string,
  companyId: string,
): Promise<boolean> {
  const companies = await listAccessibleCompanies(tx, contactId);
  return companies.some((c) => c.companyId === companyId);
}
