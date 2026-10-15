import type { CompanyStatus, PoaStatus, TaxRegime, TenantId, UserId } from '@contab/domain';
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { NotFoundError } from '../errors';
import { clientCompanies } from '../schema';
import type { TenantTx } from '../tenant';

export type Company = typeof clientCompanies.$inferSelect;

export type CompanyInput = {
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  regime: TaxRegime;
  stateRegistration?: string | null;
  municipalRegistration?: string | null;
  poaStatus?: PoaStatus;
  poaValidUntil?: string | null;
  responsibleUserId?: UserId | null;
  notes?: string | null;
};

export type CompanyFilter = {
  search?: string;
  status?: CompanyStatus;
  regime?: TaxRegime;
  limit?: number;
  offset?: number;
};

const active = isNull(clientCompanies.deletedAt);

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listCompanies(
  tx: TenantTx,
  filter: CompanyFilter = {},
): Promise<{ rows: Company[]; total: number }> {
  const conditions: SQL[] = [active];
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const digits = search.replace(/[.\-/\s]/g, '').toUpperCase();
    conditions.push(
      or(
        ilike(clientCompanies.legalName, pattern),
        ilike(clientCompanies.tradeName, pattern),
        ...(digits ? [ilike(clientCompanies.cnpj, `${escapeLike(digits)}%`)] : []),
      )!,
    );
  }
  if (filter.status) conditions.push(eq(clientCompanies.status, filter.status));
  if (filter.regime) conditions.push(eq(clientCompanies.regime, filter.regime));
  const where = and(...conditions);

  const rows = await tx
    .select()
    .from(clientCompanies)
    .where(where)
    .orderBy(asc(sql`lower(${clientCompanies.legalName})`))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);
  const [total] = await tx.select({ n: count() }).from(clientCompanies).where(where);
  return { rows, total: total?.n ?? 0 };
}

export async function getCompany(tx: TenantTx, companyId: string): Promise<Company> {
  const [row] = await tx
    .select()
    .from(clientCompanies)
    .where(and(eq(clientCompanies.id, companyId), active));
  if (!row) throw new NotFoundError('client_company', companyId);
  return row;
}

export async function findCompanyByCnpj(tx: TenantTx, cnpj: string): Promise<Company | null> {
  const [row] = await tx
    .select()
    .from(clientCompanies)
    .where(and(eq(clientCompanies.cnpj, cnpj), active));
  return row ?? null;
}

export async function insertCompany(
  tx: TenantTx,
  tenantId: TenantId,
  input: CompanyInput,
): Promise<Company> {
  const [row] = await tx
    .insert(clientCompanies)
    .values({ tenantId, id: uuidv7(), ...input })
    .returning();
  return row!;
}

export async function updateCompany(
  tx: TenantTx,
  companyId: string,
  patch: Partial<CompanyInput> & { status?: CompanyStatus },
): Promise<Company> {
  const [row] = await tx
    .update(clientCompanies)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(clientCompanies.id, companyId), active))
    .returning();
  if (!row) throw new NotFoundError('client_company', companyId);
  return row;
}
