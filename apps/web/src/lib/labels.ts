import type { Role } from '@contab/domain';

export const ROLE_LABEL: Record<Role, string> = {
  dono: 'Dono',
  admin: 'Admin',
  contador: 'Contador',
  atendente: 'Atendente',
};

export const INVITATION_STATUS_LABEL = {
  pendente: 'Pendente',
  aceito: 'Aceito',
  revogado: 'Revogado',
  expirado: 'Expirado',
  aguardando_envio: 'Enviando',
} as const;

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(date);
}

export const REGIME_LABEL = {
  SN: 'Simples Nacional',
  MEI: 'MEI',
  LP: 'Lucro Presumido',
  LR: 'Lucro Real',
} as const;

export const COMPANY_STATUS_LABEL = { ativa: 'Ativa', inativa: 'Inativa' } as const;

export const POA_STATUS_LABEL = {
  nao_verificada: 'Não verificada',
  ativa: 'Ativa',
  vencida: 'Vencida',
} as const;

export const CONTACT_ROLE_LABEL = {
  socio: 'Sócio',
  financeiro: 'Financeiro',
  outro: 'Outro',
} as const;

export const CHANNEL_LABEL = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  ambos: 'WhatsApp e e-mail',
} as const;

export const CATEGORY_LABEL = {
  contrato_social: 'Contrato social e alterações',
  cartao_cnpj: 'Cartão CNPJ',
  alvaras_licencas: 'Alvarás e licenças',
  certidoes: 'Certidões',
  documentos_socios: 'Documentos dos sócios',
  outros: 'Outros',
} as const;

export const VERSION_STATUS_LABEL = {
  aguardando_envio: 'Envio não concluído',
  verificando: 'Verificando o arquivo',
  disponivel: 'Disponível',
  rejeitado: 'Recusado',
} as const;

export const REJECTION_LABEL: Record<string, string> = {
  arquivo_nao_enviado: 'o arquivo não chegou',
  tamanho: 'o tamanho não confere',
  tipo_diferente: 'o conteúdo não é PDF, JPG ou PNG',
};

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const GUIDE_STATUS_LABEL = {
  rascunho: 'Rascunho',
  publicada: 'Publicada',
  vencida: 'Vencida',
  paga: 'Paga',
  substituida: 'Substituída',
  cancelada: 'Cancelada',
} as const;

export const GUIDE_TYPE_NAME = {
  das_simples: 'DAS do Simples',
  das_mei: 'DAS do MEI',
  dctfweb: 'DCTFWeb',
  darf: 'DARF',
  icms: 'ICMS',
  iss: 'ISS',
  fgts: 'FGTS',
  pgfn: 'PGFN',
  outro: 'Outro',
} as const;

export const DELIVERY_STATUS_LABEL = {
  enfileirado: 'Na fila',
  enviado: 'Enviado',
  entregue: 'Entregue',
  lido: 'Lido',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
} as const;

export const DELIVERY_TRIGGER_LABEL = {
  publicacao: 'Publicação',
  lembrete: 'Lembrete',
  vencida: 'Aviso de vencida',
  pago: 'Pagamento confirmado',
} as const;

/** "2026-11-20" → "20/11/2026" */
export function formatIsoDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
