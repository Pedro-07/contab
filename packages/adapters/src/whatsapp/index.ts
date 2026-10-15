/**
 * Adaptador do WhatsApp (ADR 0005): só a Cloud API oficial da Meta. Cada escritório usa
 * o próprio WABA e número (P2, P21); as credenciais chegam por chamada, nunca ficam aqui.
 * Timeout, retentativa só em erro temporário e nenhum conteúdo de mensagem em log.
 *
 * `fake` é a implementação de desenvolvimento, testes e CI: não chama a Meta.
 */
import { logger } from '@contab/config/logger';
import type { TemplateDef } from '@contab/domain';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type WhatsAppConnection = {
  appId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
};

export type DocumentAttachment = { mediaId: string; fileName: string };

export type TemplateMessage = {
  to: string;
  templateName: string;
  language: string;
  category: TemplateDef['category'];
  bodyValues: string[];
  document?: DocumentAttachment;
  /** Sufixo do botão de URL (token do link seguro). */
  linkSuffix?: string;
};

export type SubmittedTemplate = { templateId: string; status: string };
export type TemplateState = { templateId: string; status: string; reason: string | null };

export interface WhatsAppProvider {
  readonly name: 'cloud' | 'fake';
  verifyConnection(
    c: WhatsAppConnection,
  ): Promise<{ displayPhone: string; verifiedName: string; qualityRating: string | null }>;
  uploadMedia(
    c: WhatsAppConnection,
    file: { bytes: Uint8Array; contentType: string; fileName: string },
  ): Promise<string>;
  sendTemplate(c: WhatsAppConnection, message: TemplateMessage): Promise<{ messageId: string }>;
  submitTemplate(
    c: WhatsAppConnection,
    def: TemplateDef,
    options: { name: string; linkBaseUrl: string },
  ): Promise<SubmittedTemplate>;
  getTemplate(c: WhatsAppConnection, name: string): Promise<TemplateState | null>;
}

/** Erro da Meta. `permanent`: não adianta tentar de novo (número inválido, template pausado…). */
export class WhatsAppError extends Error {
  constructor(
    readonly code: number | null,
    readonly permanent: boolean,
    readonly kind: 'template_indisponivel' | 'destinatario' | 'credencial' | 'limite' | 'outro',
  ) {
    super(`WhatsApp: erro ${code ?? 'desconhecido'} (${kind})`);
    this.name = 'WhatsAppError';
  }
}

/** Classifica os códigos de erro da Cloud API. */
export function classifyError(code: number | null, httpStatus: number): WhatsAppError {
  if (code === 132015 || code === 132016 || code === 132001 || code === 132000)
    return new WhatsAppError(code, true, 'template_indisponivel');
  if (code === 131026 || code === 131030 || code === 133010 || code === 131021 || code === 131050)
    return new WhatsAppError(code, true, 'destinatario');
  if (code === 190 || code === 10 || code === 200 || httpStatus === 401)
    return new WhatsAppError(code, true, 'credencial');
  if (
    code === 4 ||
    code === 80007 ||
    code === 130429 ||
    code === 131048 ||
    code === 131056 ||
    httpStatus === 429
  )
    return new WhatsAppError(code, false, 'limite');
  // Erro genérico: temporário se for 5xx, o 131000 da Meta ou sem código (rede); senão, permanente.
  const temporary = httpStatus >= 500 || code === 131000 || code === null;
  return new WhatsAppError(code, !temporary, 'outro');
}

// ---------------------------------------------------------------------------
// Assinatura do webhook
// ---------------------------------------------------------------------------

/** Confere o X-Hub-Signature-256 (HMAC SHA-256 do corpo cru com o app secret). */
export function verifySignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Assina um corpo como a Meta faria (testes e simulação). */
export function signBody(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Componentes de template (formato da Meta)
// ---------------------------------------------------------------------------

function sendComponents(message: TemplateMessage): unknown[] {
  if (message.category === 'AUTHENTICATION') {
    const code = message.bodyValues[0] ?? '';
    return [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
    ];
  }
  const components: unknown[] = [];
  if (message.document) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: { id: message.document.mediaId, filename: message.document.fileName },
        },
      ],
    });
  }
  components.push({
    type: 'body',
    parameters: message.bodyValues.map((text) => ({ type: 'text', text })),
  });
  if (message.linkSuffix) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: message.linkSuffix }],
    });
  }
  return components;
}

function submitComponents(
  def: TemplateDef,
  linkBaseUrl: string,
  headerHandle: string | null,
): unknown[] {
  if (def.category === 'AUTHENTICATION') {
    return [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }] },
    ];
  }
  const components: unknown[] = [];
  if (def.header === 'document') {
    components.push({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: { header_handle: [headerHandle] },
    });
  }
  components.push({
    type: 'BODY',
    text: def.body,
    example: { body_text: [def.variables.map((v) => v.example)] },
  });
  if (def.linkButton) {
    const base = linkBaseUrl.replace(/\/$/, '');
    components.push({
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: def.linkButton,
          url: `${base}/g/{{1}}`,
          example: [`${base}/g/exemplo`],
        },
      ],
    });
  }
  return components;
}

// ---------------------------------------------------------------------------
// Cloud API
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 3;

/** PDF mínimo usado como exemplo de cabeçalho na submissão de template. */
const SAMPLE_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export function createCloudApiProvider(options: { graphVersion: string }): WhatsAppProvider {
  const base = `https://graph.facebook.com/${options.graphVersion}`;

  async function call<T>(
    token: string,
    path: string,
    init: {
      method?: string;
      json?: unknown;
      body?: RequestInit['body'];
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    let last: WhatsAppError | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${base}/${path}`, {
          method: init.method ?? 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            ...(init.json ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
          body: init.json ? JSON.stringify(init.json) : init.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        last = new WhatsAppError(null, false, 'outro');
        await backoff(attempt);
        continue;
      }
      const data = (await response.json().catch(() => ({}))) as {
        error?: { code?: number };
      } & T;
      if (response.ok && !data.error) return data;
      last = classifyError(data.error?.code ?? null, response.status);
      if (last.permanent) break;
      await backoff(attempt);
    }
    logger.warn({ provider: 'meta', code: last?.code, kind: last?.kind }, 'falha na Cloud API');
    throw last!;
  }

  async function uploadHeaderExample(c: WhatsAppConnection): Promise<string> {
    const session = await call<{ id: string }>(
      c.accessToken,
      `${c.appId}/uploads?file_length=${SAMPLE_PDF.length}&file_type=application/pdf`,
      { method: 'POST' },
    );
    const uploaded = await call<{ h: string }>(c.accessToken, session.id, {
      method: 'POST',
      body: SAMPLE_PDF,
      headers: { file_offset: '0' },
    });
    return uploaded.h;
  }

  return {
    name: 'cloud',

    async verifyConnection(c) {
      const data = await call<{
        display_phone_number: string;
        verified_name: string;
        quality_rating?: string;
      }>(
        c.accessToken,
        `${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        {},
      );
      return {
        displayPhone: data.display_phone_number,
        verifiedName: data.verified_name,
        qualityRating: data.quality_rating ?? null,
      };
    },

    async uploadMedia(c, file) {
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('type', file.contentType);
      form.set(
        'file',
        new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
        file.fileName,
      );
      const data = await call<{ id: string }>(c.accessToken, `${c.phoneNumberId}/media`, {
        method: 'POST',
        body: form,
      });
      return data.id;
    },

    async sendTemplate(c, message) {
      const data = await call<{ messages: Array<{ id: string }> }>(
        c.accessToken,
        `${c.phoneNumberId}/messages`,
        {
          method: 'POST',
          json: {
            messaging_product: 'whatsapp',
            to: message.to.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: message.templateName,
              language: { code: message.language },
              components: sendComponents(message),
            },
          },
        },
      );
      logger.info({ provider: 'meta', op: 'template_enviado' }, 'mensagem enviada');
      return { messageId: data.messages[0]!.id };
    },

    async submitTemplate(c, def, opts) {
      const handle = def.header === 'document' ? await uploadHeaderExample(c) : null;
      const data = await call<{ id: string; status: string }>(
        c.accessToken,
        `${c.wabaId}/message_templates`,
        {
          method: 'POST',
          json: {
            name: opts.name,
            language: def.language,
            category: def.category,
            components: submitComponents(def, opts.linkBaseUrl, handle),
          },
        },
      );
      return { templateId: data.id, status: data.status };
    },

    async getTemplate(c, name) {
      const data = await call<{
        data: Array<{ id: string; status: string; rejected_reason?: string }>;
      }>(c.accessToken, `${c.wabaId}/message_templates?name=${encodeURIComponent(name)}`, {});
      const t = data.data[0];
      return t ? { templateId: t.id, status: t.status, reason: t.rejected_reason ?? null } : null;
    },
  };
}

async function backoff(attempt: number): Promise<void> {
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
}

// ---------------------------------------------------------------------------
// Implementação falsa (dev, testes e CI)
// ---------------------------------------------------------------------------

export type FakeSent = { connection: string; message: TemplateMessage; messageId: string };

/**
 * Não chama a Meta. Aprova os templates na hora e guarda as mensagens em memória.
 * Telefones terminados em 0000 simulam número inválido (erro permanente, 131026).
 */
export function createFakeProvider(): WhatsAppProvider & { sent: FakeSent[] } {
  const sent: FakeSent[] = [];
  return {
    name: 'fake',
    sent,
    async verifyConnection(c) {
      if (c.accessToken === 'token-invalido') throw new WhatsAppError(190, true, 'credencial');
      return {
        displayPhone: '+55 98 99999-0000',
        verifiedName: 'Número de teste',
        qualityRating: 'GREEN',
      };
    },
    async uploadMedia() {
      return `fake-media-${randomUUID()}`;
    },
    async sendTemplate(c, message) {
      if (message.to.endsWith('0000')) throw new WhatsAppError(131026, true, 'destinatario');
      const messageId = `wamid.fake-${randomUUID()}`;
      sent.push({ connection: c.phoneNumberId, message, messageId });
      return { messageId };
    },
    async submitTemplate() {
      return { templateId: `fake-template-${randomUUID()}`, status: 'APPROVED' };
    },
    async getTemplate(_c, _name) {
      return null;
    },
  };
}

export type WhatsAppConfig = {
  WHATSAPP_PROVIDER: 'cloud' | 'fake';
  WHATSAPP_GRAPH_VERSION: string;
};

export function createWhatsAppProvider(config: WhatsAppConfig): WhatsAppProvider {
  return config.WHATSAPP_PROVIDER === 'cloud'
    ? createCloudApiProvider({ graphVersion: config.WHATSAPP_GRAPH_VERSION })
    : createFakeProvider();
}

/** Status da Meta → status do template no escritório. */
export function mapTemplateStatus(
  metaStatus: string,
): 'enviado' | 'aprovado' | 'rejeitado' | 'pausado' | 'desativado' {
  switch (metaStatus.toUpperCase()) {
    case 'APPROVED':
      return 'aprovado';
    case 'REJECTED':
      return 'rejeitado';
    case 'PAUSED':
      return 'pausado';
    case 'DISABLED':
      return 'desativado';
    default:
      return 'enviado';
  }
}
