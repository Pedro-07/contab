/**
 * Biblioteca de templates da plataforma (P9, I3, ADR 0008). A plataforma escreve e
 * versiona; cada escritório só ativa e tem o nome dele no texto. A definição mora no
 * código e é gravada em template_library pela migração e por `pnpm templates:sync`.
 *
 * Variáveis do corpo: {{1}}, {{2}}… na ordem de `variables` (formato da Meta).
 * Botão de URL: a base é o portal do escritório, preenchida na submissão a cada WABA;
 * o sufixo dinâmico é o token do link seguro.
 */

export type TemplateCategory = 'UTILITY' | 'AUTHENTICATION';

export type TemplateVariable = {
  name: string;
  /** Exemplo exigido pela Meta na submissão. Fictício. */
  example: string;
};

export type TemplateDef = {
  key: TemplateKey;
  version: number;
  language: 'pt_BR';
  category: TemplateCategory;
  /** Cabeçalho com o PDF anexado. */
  header: 'document' | null;
  body: string;
  variables: TemplateVariable[];
  /** Botão "abrir" com o link seguro (sufixo dinâmico). */
  linkButton: string | null;
  /** Assunto do e-mail equivalente. */
  emailSubject: string;
};

export const TEMPLATE_KEYS = [
  'guia_disponivel',
  'lembrete_vencimento',
  'guia_vencida',
  'pagamento_confirmado',
  'documento_disponivel',
  'codigo_acesso',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const v = (name: string, example: string): TemplateVariable => ({ name, example });

export const TEMPLATE_LIBRARY: Record<TemplateKey, TemplateDef> = {
  guia_disponivel: {
    key: 'guia_disponivel',
    version: 1,
    language: 'pt_BR',
    category: 'UTILITY',
    header: 'document',
    body:
      'Olá, {{1}}. O escritório {{2}} disponibilizou a guia {{3}} da empresa {{4}}, ' +
      'competência {{5}}, no valor de {{6}}, com vencimento em {{7}}. ' +
      'O PDF está anexado; o Pix e a linha digitável estão no link abaixo.',
    variables: [
      v('contato', 'Maria'),
      v('escritorio', 'Escritório Exemplo'),
      v('tipo', 'DAS do Simples Nacional'),
      v('empresa', 'Padaria Exemplo'),
      v('competencia', '10/2026'),
      v('valor', 'R$ 1.234,56'),
      v('vencimento', '20/11/2026'),
    ],
    linkButton: 'Ver guia',
    emailSubject: 'Guia {{3}} de {{4}}: vence em {{7}}',
  },
  lembrete_vencimento: {
    key: 'lembrete_vencimento',
    version: 1,
    language: 'pt_BR',
    category: 'UTILITY',
    header: null,
    body:
      'Olá, {{1}}. Lembrete do escritório {{2}}: a guia {{3}} da empresa {{4}}, ' +
      'no valor de {{5}}, vence em {{6}}. Se já pagou, desconsidere.',
    variables: [
      v('contato', 'Maria'),
      v('escritorio', 'Escritório Exemplo'),
      v('tipo', 'DAS do Simples Nacional'),
      v('empresa', 'Padaria Exemplo'),
      v('valor', 'R$ 1.234,56'),
      v('vencimento', '20/11/2026'),
    ],
    linkButton: 'Ver guia',
    emailSubject: 'Lembrete: guia {{3}} de {{4}} vence em {{6}}',
  },
  guia_vencida: {
    key: 'guia_vencida',
    version: 1,
    language: 'pt_BR',
    category: 'UTILITY',
    header: null,
    body:
      'Olá, {{1}}. A guia {{2}} da empresa {{3}}, que venceu em {{4}}, ainda não ' +
      'aparece como paga para o escritório {{5}}. Abra o link para ver as opções.',
    variables: [
      v('contato', 'Maria'),
      v('tipo', 'DAS do Simples Nacional'),
      v('empresa', 'Padaria Exemplo'),
      v('vencimento', '20/11/2026'),
      v('escritorio', 'Escritório Exemplo'),
    ],
    linkButton: 'Ver opções',
    emailSubject: 'Guia {{2}} de {{3}} venceu em {{4}}',
  },
  pagamento_confirmado: {
    key: 'pagamento_confirmado',
    version: 1,
    language: 'pt_BR',
    category: 'UTILITY',
    header: null,
    body:
      'Olá, {{1}}. O escritório {{2}} confirmou o pagamento da guia {{3}} da empresa ' +
      '{{4}}, competência {{5}}. Obrigado!',
    variables: [
      v('contato', 'Maria'),
      v('escritorio', 'Escritório Exemplo'),
      v('tipo', 'DAS do Simples Nacional'),
      v('empresa', 'Padaria Exemplo'),
      v('competencia', '10/2026'),
    ],
    linkButton: null,
    emailSubject: 'Pagamento confirmado: guia {{3}} de {{4}}',
  },
  documento_disponivel: {
    key: 'documento_disponivel',
    version: 1,
    language: 'pt_BR',
    category: 'UTILITY',
    header: 'document',
    body: 'Olá, {{1}}. O escritório {{2}} enviou o documento "{{3}}" da empresa {{4}}.',
    variables: [
      v('contato', 'Maria'),
      v('escritorio', 'Escritório Exemplo'),
      v('documento', 'Contrato social'),
      v('empresa', 'Padaria Exemplo'),
    ],
    linkButton: null,
    emailSubject: 'Documento "{{3}}" de {{4}}',
  },
  // Formato fixo da Meta para autenticação: o texto é gerado por ela.
  codigo_acesso: {
    key: 'codigo_acesso',
    version: 1,
    language: 'pt_BR',
    category: 'AUTHENTICATION',
    header: null,
    body: '{{1}} é o seu código de acesso. Ele vale por 5 minutos.',
    variables: [v('codigo', '123456')],
    linkButton: null,
    emailSubject: 'Seu código de acesso',
  },
};

/** Nome do template na Meta: só minúsculas, números e sublinhado, com a versão. */
export function metaTemplateName(def: TemplateDef): string {
  return `${def.key}_v${def.version}`;
}

/** Texto com as variáveis preenchidas (e-mail e conferência). */
export function renderTemplate(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] ?? '');
}

/**
 * Valores na ordem da definição. A Meta recusa variável vazia, com quebra de linha ou
 * com mais de 4 espaços seguidos; o texto é ajustado aqui para não falhar no envio.
 */
export function templateValues(def: TemplateDef, values: Record<string, string>): string[] {
  return def.variables.map((variable) => {
    const raw = values[variable.name];
    if (raw === undefined) throw new Error(`Variável ${variable.name} faltando em ${def.key}`);
    const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 200);
    return clean || '-';
  });
}

export const GUIDE_TYPE_LABEL = {
  das_simples: 'DAS do Simples Nacional',
  das_mei: 'DAS do MEI',
  dctfweb: 'DCTFWeb',
  darf: 'DARF',
  icms: 'ICMS',
  iss: 'ISS',
  fgts: 'FGTS',
  pgfn: 'PGFN',
  outro: 'de tributo',
} as const;
