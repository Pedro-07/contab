/** Empresas-clientes, contatos e documentos (incremento 2). */

export const TAX_REGIMES = ['SN', 'MEI', 'LP', 'LR'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const COMPANY_STATUSES = ['ativa', 'inativa'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Procuração eletrônica no e-CAC para o CNPJ do escritório. */
export const POA_STATUSES = ['nao_verificada', 'ativa', 'vencida'] as const;
export type PoaStatus = (typeof POA_STATUSES)[number];

export const CONTACT_ROLES = ['socio', 'financeiro', 'outro'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const PREFERRED_CHANNELS = ['whatsapp', 'email', 'ambos'] as const;
export type PreferredChannel = (typeof PREFERRED_CHANNELS)[number];

export const CONSENT_CHANNELS = ['whatsapp', 'email'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** padrao_escritorio: autorização por padrão na entrega do núcleo (P25). */
export const CONSENT_SOURCES = [
  'importacao',
  'cadastro_manual',
  'padrao_escritorio',
  'cliente',
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Pastas fixas da empresa (recomendação aprovada, seção 2 do plano do incremento). */
export const DOCUMENT_CATEGORIES = [
  'contrato_social',
  'cartao_cnpj',
  'alvaras_licencas',
  'certidoes',
  'documentos_socios',
  'outros',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
