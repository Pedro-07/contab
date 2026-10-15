/**
 * Importação de empresas e contatos por CSV (incremento 2, seção 5).
 * - Uma linha por contato; CNPJ repetido junta os contatos na mesma empresa.
 * - Separador `;` ou `,`; UTF-8 ou Windows-1252 (Excel em português).
 * - Linhas com erro não entram; as válidas entram numa única transação.
 * - Autorização (P25): coluna em branco vale o padrão do contato novo; "não" desmarca.
 * O conteúdo do arquivo nunca vai para log nem para a auditoria.
 */
import {
  findCompanyByCnpj,
  grantPortalAccess,
  insertCompany,
  linkContact,
  recordAudit,
  updateCompany,
  withTenant,
  type TenantContext,
} from '@contab/db';
import {
  CONTACT_ROLES,
  isOneOf,
  parseCnpj,
  parsePhone,
  PREFERRED_CHANNELS,
  TAX_REGIMES,
  type ContactRole,
  type PreferredChannel,
  type TaxRegime,
  type UserId,
} from '@contab/domain';
import { z } from 'zod';
import {
  applyConsents,
  ClientInputError,
  requireClientEditor,
  upsertContactRecord,
} from './clients';
import { actorUserId } from './guard';

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 2000;

export const CSV_COLUMNS = [
  'cnpj',
  'razao_social',
  'nome_fantasia',
  'regime',
  'inscricao_estadual',
  'contato_nome',
  'contato_telefone',
  'contato_email',
  'contato_papel',
  'canal_preferido',
  'aceita_whatsapp',
  'aceita_email',
  'recebe_envios',
  'acesso_portal',
] as const;

const REQUIRED = ['cnpj', 'razao_social', 'regime'] as const;

export const CSV_TEMPLATE =
  CSV_COLUMNS.join(';') +
  '\n' +
  '11.222.333/0001-81;Padaria Exemplo Ltda;Padaria Exemplo;SN;123456789;Maria Exemplo;(98) 91234-5678;maria@exemplo.com.br;socio;whatsapp;sim;nao;sim;sim\n';

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------

/** UTF-8 quando válido; senão Windows-1252, que é como o Excel em português salva. */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** CSV com aspas (RFC 4180). O separador é o que aparecer mais no cabeçalho. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === separator) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export type CsvRow = {
  line: number;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  regime: TaxRegime;
  stateRegistration: string | null;
  contact: {
    name: string;
    phone: string | null;
    email: string | null;
    role: ContactRole;
    preferredChannel: PreferredChannel;
    /** undefined: coluna em branco, vale o padrão (P25). */
    whatsappOptIn: boolean | undefined;
    emailOptIn: boolean | undefined;
    receivesDeliveries: boolean;
    portalAccess: boolean;
  } | null;
};

export type CsvError = { line: number; message: string };

const YES = new Set(['sim', 's', 'yes', 'y', 'x', '1', 'true', 'verdadeiro']);
const NO = new Set(['', 'nao', 'não', 'n', 'no', '0', 'false', 'falso']);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
}

const emailSchema = z.email();

function parseRow(
  get: (column: (typeof CSV_COLUMNS)[number]) => string,
  line: number,
): CsvRow | CsvError {
  const fail = (message: string): CsvError => ({ line, message });
  const flag = <F extends boolean | undefined>(
    column: (typeof CSV_COLUMNS)[number],
    fallback: F,
  ): boolean | F | null => {
    const v = get(column).toLowerCase();
    if (v === '') return fallback;
    if (YES.has(v)) return true;
    if (NO.has(v)) return false;
    return null;
  };

  const cnpj = parseCnpj(get('cnpj'));
  if (!cnpj) return fail('CNPJ inválido.');
  const legalName = get('razao_social');
  if (legalName.length < 2) return fail('Razão social em branco.');
  const regime = get('regime').toUpperCase();
  if (!isOneOf(TAX_REGIMES, regime)) return fail('Regime deve ser SN, MEI, LP ou LR.');

  const base = {
    line,
    cnpj,
    legalName: legalName.slice(0, 200),
    tradeName: get('nome_fantasia').slice(0, 200) || null,
    regime,
    stateRegistration: get('inscricao_estadual').slice(0, 30) || null,
  };

  const name = get('contato_nome');
  const rawPhone = get('contato_telefone');
  const rawEmail = get('contato_email').toLowerCase();
  if (!name && !rawPhone && !rawEmail) return { ...base, contact: null };
  if (name.length < 2) return fail('Nome do contato em branco.');
  const phone = rawPhone ? parsePhone(rawPhone) : null;
  if (rawPhone && !phone) return fail('Telefone do contato inválido.');
  if (rawEmail && !emailSchema.safeParse(rawEmail).success)
    return fail('E-mail do contato inválido.');
  if (!phone && !rawEmail) return fail('Contato sem telefone e sem e-mail.');

  const role = get('contato_papel').toLowerCase() || 'outro';
  if (!isOneOf(CONTACT_ROLES, role)) return fail('Papel deve ser socio, financeiro ou outro.');
  const channel = get('canal_preferido').toLowerCase() || 'whatsapp';
  if (!isOneOf(PREFERRED_CHANNELS, channel))
    return fail('Canal preferido deve ser whatsapp, email ou ambos.');

  const whatsappOptIn = flag('aceita_whatsapp', undefined);
  const emailOptIn = flag('aceita_email', undefined);
  const receivesDeliveries = flag('recebe_envios', true);
  const portalAccess = flag('acesso_portal', false);
  if ([whatsappOptIn, emailOptIn, receivesDeliveries, portalAccess].includes(null))
    return fail('Use "sim" ou "não" nas colunas de autorização.');
  if (whatsappOptIn === true && !phone) return fail('Aceita WhatsApp sem telefone.');
  if (emailOptIn === true && !rawEmail) return fail('Aceita e-mail sem e-mail.');

  return {
    ...base,
    contact: {
      name: name.slice(0, 200),
      phone,
      email: rawEmail || null,
      role,
      preferredChannel: channel,
      whatsappOptIn: whatsappOptIn as boolean | undefined,
      emailOptIn: emailOptIn as boolean | undefined,
      receivesDeliveries: receivesDeliveries!,
      portalAccess: portalAccess!,
    },
  };
}

export type ParsedCsv = { rows: CsvRow[]; errors: CsvError[] };

/** Lê e valida o arquivo inteiro, sem tocar no banco. */
export function readCsv(bytes: Uint8Array): ParsedCsv {
  if (bytes.length === 0) throw new ClientInputError('O arquivo está vazio.');
  if (bytes.length > CSV_MAX_BYTES) throw new ClientInputError('O arquivo passa de 1 MB.');
  const table = parseCsv(decodeCsv(bytes));
  const [header, ...body] = table;
  if (!header) throw new ClientInputError('O arquivo está vazio.');
  if (body.length > CSV_MAX_ROWS)
    throw new ClientInputError(`O arquivo passa de ${CSV_MAX_ROWS} linhas.`);

  const index = new Map(header.map((h, i) => [normalizeHeader(h), i]));
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length)
    throw new ClientInputError(`Faltam colunas no cabeçalho: ${missing.join(', ')}.`);

  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  const companyNames = new Map<string, { legalName: string; regime: string; line: number }>();
  body.forEach((cells, i) => {
    const line = i + 2; // linha 1 é o cabeçalho
    const get = (column: (typeof CSV_COLUMNS)[number]) => {
      const at = index.get(column);
      return at === undefined ? '' : (cells[at] ?? '').trim();
    };
    const result = parseRow(get, line);
    if ('message' in result) {
      errors.push(result);
      return;
    }
    // CNPJ repetido: os dados da empresa precisam bater com a primeira linha.
    const first = companyNames.get(result.cnpj);
    if (first && (first.legalName !== result.legalName || first.regime !== result.regime)) {
      errors.push({
        line,
        message: `Dados da empresa diferentes da linha ${first.line} (mesmo CNPJ).`,
      });
      return;
    }
    if (!first) companyNames.set(result.cnpj, { ...result, line });
    rows.push(result);
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Prévia e aplicação
// ---------------------------------------------------------------------------

export type CsvPreview = {
  companiesNew: number;
  companiesUpdated: number;
  contacts: number;
  validLines: number;
  errors: CsvError[];
};

export async function previewCsvImport(ctx: TenantContext, bytes: Uint8Array): Promise<CsvPreview> {
  await requireClientEditor(ctx);
  const { rows, errors } = readCsv(bytes);
  const cnpjs = [...new Set(rows.map((r) => r.cnpj))];
  const existing = await withTenant(ctx, async (tx) => {
    let n = 0;
    for (const cnpj of cnpjs) if (await findCompanyByCnpj(tx, cnpj)) n++;
    return n;
  });
  return {
    companiesNew: cnpjs.length - existing,
    companiesUpdated: existing,
    contacts: rows.filter((r) => r.contact).length,
    validLines: rows.length,
    errors,
  };
}

export type CsvImportResult = CsvPreview & { optIns: number };

export async function applyCsvImport(
  ctx: TenantContext,
  bytes: Uint8Array,
): Promise<CsvImportResult> {
  await requireClientEditor(ctx);
  const { rows, errors } = readCsv(bytes);
  if (rows.length === 0) throw new ClientInputError('Nenhuma linha válida para importar.');
  const actor = actorUserId(ctx) as UserId | null;

  return withTenant(ctx, async (tx) => {
    const companyIds = new Map<string, string>();
    let companiesNew = 0;
    let companiesUpdated = 0;
    let contactsCount = 0;
    let optIns = 0;

    for (const row of rows) {
      let companyId = companyIds.get(row.cnpj);
      if (!companyId) {
        const data = {
          cnpj: row.cnpj,
          legalName: row.legalName,
          tradeName: row.tradeName,
          regime: row.regime,
          stateRegistration: row.stateRegistration,
        };
        const found = await findCompanyByCnpj(tx, row.cnpj);
        if (found) {
          await updateCompany(tx, found.id, {
            ...data,
            // Campos em branco no arquivo não apagam o que já existe.
            tradeName: data.tradeName ?? found.tradeName,
            stateRegistration: data.stateRegistration ?? found.stateRegistration,
          });
          companyId = found.id;
          companiesUpdated++;
        } else {
          companyId = (await insertCompany(tx, ctx.tenantId, data)).id;
          companiesNew++;
        }
        companyIds.set(row.cnpj, companyId);
      }

      if (!row.contact) continue;
      const c = row.contact;
      const contact = await upsertContactRecord(tx, ctx, c);
      await linkContact(tx, ctx.tenantId, {
        companyId,
        contactId: contact.id,
        role: c.role,
        receivesDeliveries: c.receivesDeliveries,
      });
      contactsCount++;
      // P25: em branco vale o padrão (autorizado no contato novo); "não" desmarca.
      optIns += await applyConsents(tx, ctx, contact, {
        whatsapp: c.whatsappOptIn,
        email: c.emailOptIn,
        source: 'importacao',
      });
      if (c.portalAccess) {
        await grantPortalAccess(tx, ctx.tenantId, {
          contactId: contact.id,
          companyId,
          grantedByUserId: actor,
        });
      }
    }

    // Só os totais: nada do conteúdo do arquivo vai para a auditoria.
    await recordAudit(tx, ctx, {
      action: 'clientes.importados',
      resourceType: 'client_company',
      metadata: {
        empresas_novas: companiesNew,
        empresas_atualizadas: companiesUpdated,
        contatos: contactsCount,
        opt_ins: optIns,
        linhas_com_erro: errors.length,
      },
    });

    return {
      companiesNew,
      companiesUpdated,
      contacts: contactsCount,
      validLines: rows.length,
      errors,
      optIns,
    };
  });
}
