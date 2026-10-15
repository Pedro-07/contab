/**
 * Webhook do WhatsApp (I2, CLAUDE.md "Webhooks"): validar a assinatura, gravar em
 * webhook_events com ID externo único, responder 200 e processar na fila.
 * Conexão manual: a URL tem uma chave secreta por conexão, que identifica o escritório e o
 * app secret. O phone_number_id (ou o WABA, nos eventos de template) do payload precisa ser
 * da conexão. Nenhum texto de mensagem é guardado nem vai para log: só o sinal de opt-out.
 */
import { verifySignature } from '@contab/adapters/whatsapp';
import {
  findContactByPhone,
  getChannel,
  getWebhookEvent,
  insertWebhookEvent,
  markWebhookProcessed,
  recordConsent,
  withTenant,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { recordSecurityEvent, resolveWhatsAppChannel } from '@contab/db/global';
import { enqueue } from '@contab/db/queue';
import type { TenantId } from '@contab/domain';
import { z } from 'zod';
import { applyTemplateStatus, applyWhatsAppStatus } from './deliveries';
import { loadConnection, type DeliveryDeps } from './delivery-deps';
import { hashSecret } from './whatsapp-connection';

export type WebhookMeta = { requestId: string; ip?: string | null };

function webhookCtx(tenantId: TenantId, meta: WebhookMeta): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName: 'webhook.whatsapp', jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip ?? null,
  };
}

const OPT_OUT_WORDS = new Set(['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar']);

/** "SAIR", "Sair.", "sair!" → opt-out (RN7). */
export function isOptOutText(text: string | undefined): boolean {
  if (!text) return false;
  const word = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return OPT_OUT_WORDS.has(word);
}

const payloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })),
      }),
    )
    .default([]),
});

const messagesValue = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  statuses: z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        timestamp: z.string(),
        errors: z.array(z.object({ code: z.number().optional() })).optional(),
      }),
    )
    .optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        type: z.string(),
        text: z.object({ body: z.string() }).optional(),
      }),
    )
    .optional(),
});

const templateValue = z.object({
  event: z.string(),
  message_template_id: z.union([z.string(), z.number()]).transform(String),
  message_template_name: z.string(),
  reason: z.string().nullish(),
});

type ParsedEvent = { externalId: string; kind: string; payload: Record<string, unknown> };

export type WebhookResult = { status: 200 | 401 | 404; body?: string };

/** POST do webhook (conexão manual). */
export async function receiveWhatsAppWebhook(
  webhookKey: string,
  rawBody: string,
  signature: string | null,
  deps: Pick<DeliveryDeps, 'boss' | 'cipher'>,
  meta: WebhookMeta,
): Promise<WebhookResult> {
  const found = await resolveWhatsAppChannel({ webhookKeyHash: hashSecret(webhookKey) });
  if (!found) {
    await recordSecurityEvent({
      type: 'webhook_signature_invalid',
      requestId: meta.requestId,
      ip: meta.ip ?? null,
      details: { motivo: 'chave_desconhecida' },
    });
    return { status: 404 };
  }
  const ctx = webhookCtx(found.tenantId, meta);
  return withTenant(ctx, async (tx) => {
    const { channel, appSecret } = await loadConnection(tx, ctx, deps.cipher, found.channelId);
    if (!verifySignature(appSecret, rawBody, signature)) {
      await recordSecurityEvent({
        type: 'webhook_signature_invalid',
        activeTenantId: ctx.tenantId,
        resourceType: 'channel',
        resourceId: channel.id,
        requestId: meta.requestId,
        ip: meta.ip ?? null,
      });
      return { status: 401 };
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { status: 200 };
    }
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) return { status: 200 };

    const events: ParsedEvent[] = [];
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field === 'message_template_status_update') {
          const v = templateValue.safeParse(change.value);
          if (!v.success) continue;
          if (entry.id !== channel.wabaId) {
            await mismatch(ctx, channel.id, meta);
            continue;
          }
          events.push({
            externalId: `tpl:${v.data.message_template_id}:${v.data.event}:${entry.id}`,
            kind: 'template',
            payload: {
              channelId: channel.id,
              templateId: v.data.message_template_id,
              name: v.data.message_template_name,
              status: v.data.event,
              reason: v.data.reason ?? null,
            },
          });
          continue;
        }
        if (change.field !== 'messages') continue;
        const v = messagesValue.safeParse(change.value);
        if (!v.success) continue;
        if (v.data.metadata.phone_number_id !== channel.phoneNumberId) {
          await mismatch(ctx, channel.id, meta);
          continue;
        }
        for (const s of v.data.statuses ?? []) {
          events.push({
            externalId: `status:${s.id}:${s.status}`,
            kind: 'status',
            payload: {
              messageId: s.id,
              status: s.status,
              timestamp: Number(s.timestamp) * 1000,
              errorCode: s.errors?.[0]?.code ?? null,
            },
          });
        }
        for (const m of v.data.messages ?? []) {
          // Só o sinal de opt-out; o texto não é guardado (inbox fica para outro incremento).
          events.push({
            externalId: `msg:${m.id}`,
            kind: 'message',
            payload: { from: m.from, optOut: m.type === 'text' && isOptOutText(m.text?.body) },
          });
        }
      }
    }
    for (const event of events) {
      const row = await insertWebhookEvent(tx, ctx.tenantId, { provider: 'meta', ...event });
      if (row) await enqueue(deps.boss, ctx, tx, 'webhook.meta.process', { eventId: row.id });
    }
    return { status: 200 };
  });
}

async function mismatch(ctx: TenantContext, channelId: string, meta: WebhookMeta) {
  await recordSecurityEvent({
    type: 'webhook_signature_invalid',
    activeTenantId: ctx.tenantId,
    resourceType: 'channel',
    resourceId: channelId,
    requestId: meta.requestId,
    ip: meta.ip ?? null,
    details: { motivo: 'numero_de_outra_conexao' },
  });
}

/** GET de verificação da assinatura do webhook (desafio da Meta). */
export async function verifyWhatsAppSubscription(
  webhookKey: string,
  params: { mode: string | null; token: string | null; challenge: string | null },
  meta: WebhookMeta,
): Promise<string | null> {
  if (params.mode !== 'subscribe' || !params.token || !params.challenge) return null;
  const found = await resolveWhatsAppChannel({ webhookKeyHash: hashSecret(webhookKey) });
  if (!found) return null;
  return withTenant(webhookCtx(found.tenantId, meta), async (tx) => {
    const channel = await getChannel(tx, found.channelId);
    return hashSecret(params.token!) === channel.verifyTokenHash ? params.challenge : null;
  });
}

/** Job webhook.meta.process. Idempotente: evento já processado é ignorado. */
export async function processWebhookEvent(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  eventId: string,
): Promise<void> {
  const event = await getWebhookEvent(tx, eventId);
  if (!event || event.processedAt) return;
  const p = event.payload as Record<string, unknown>;
  if (event.kind === 'status') {
    await applyWhatsAppStatus(tx, ctx, deps, {
      messageId: String(p.messageId),
      status: String(p.status),
      timestamp: new Date(Number(p.timestamp)),
      errorCode: typeof p.errorCode === 'number' ? p.errorCode : null,
    });
  } else if (event.kind === 'template') {
    await applyTemplateStatus(tx, ctx, String(p.channelId), {
      templateId: String(p.templateId),
      name: String(p.name),
      status: String(p.status),
      reason: (p.reason as string | null) ?? null,
    });
  } else if (event.kind === 'message' && p.optOut === true) {
    const contact = await findContactByPhone(tx, `+${String(p.from).replace(/\D/g, '')}`);
    if (contact?.whatsappOptInAt) {
      await recordConsent(tx, ctx.tenantId, {
        contactId: contact.id,
        channel: 'whatsapp',
        optIn: false,
        source: 'cliente',
        actorUserId: null,
      });
    }
  }
  await markWebhookProcessed(tx, event.id);
}
