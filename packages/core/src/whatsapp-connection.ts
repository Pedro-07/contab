/**
 * Conexões › WhatsApp (P2, P21, I2). Conexão manual com WABA ID, Phone Number ID, ID do
 * app, token e app secret. Os segredos ficam cifrados; a URL secreta do webhook e o verify
 * token são mostrados uma vez e só o hash fica no banco.
 */
import { WhatsAppError } from '@contab/adapters/whatsapp';
import {
  findWhatsAppChannel,
  insertChannel,
  listLibrary,
  listTenantTemplates,
  recordAudit,
  updateChannel,
  upsertCredential,
  upsertTenantTemplate,
  withTenant,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  canManageConnections,
  metaTemplateName,
  TEMPLATE_LIBRARY,
  type TemplateKey,
} from '@contab/domain';
import { mapTemplateStatus } from '@contab/adapters/whatsapp';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ClientInputError } from './clients';
import { loadConnection, nowOf, tenantInfo, type DeliveryDeps } from './delivery-deps';
import { actorRole, deny } from './guard';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function requireConnectionManager(ctx: TenantContext): Promise<void> {
  const role = actorRole(ctx);
  if (!role || !canManageConnections(role))
    await deny(ctx, 'Seu papel não permite alterar conexões.', 'channel');
}

const digits = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, `${label} inválido.`);

const connectSchema = z.object({
  appId: digits('ID do app'),
  wabaId: digits('WABA ID'),
  phoneNumberId: digits('Phone Number ID'),
  accessToken: z.string().trim().min(20, 'Token inválido.').max(1000),
  appSecret: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, 'App secret inválido.'),
});

export type ConnectInput = z.input<typeof connectSchema>;

export type ConnectResult = {
  /** Mostrados uma única vez para colar no app da Meta. */
  webhookPath: string;
  verifyToken: string;
  status: 'ativo' | 'erro';
  statusReason: string | null;
};

const CONNECTION_ERRORS: Record<WhatsAppError['kind'], string> = {
  credencial: 'A Meta recusou o token. Confira o token e as permissões do app.',
  destinatario: 'A Meta recusou o número. Confira o Phone Number ID.',
  template_indisponivel: 'A Meta recusou a operação.',
  limite: 'A Meta está limitando as chamadas. Tente de novo em alguns minutos.',
  outro: 'Não foi possível falar com a Meta agora. Tente de novo.',
};

async function checkConnection(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  channelId: string,
): Promise<{ status: 'ativo' | 'erro'; reason: string | null }> {
  const { connection } = await loadConnection(tx, ctx, deps.cipher, channelId);
  try {
    const info = await deps.whatsapp.verifyConnection(connection);
    await updateChannel(tx, channelId, {
      status: 'ativo',
      statusReason: null,
      displayPhone: info.displayPhone,
      verifiedName: info.verifiedName,
      qualityRating: info.qualityRating,
      lastCheckedAt: nowOf(deps),
    });
    return { status: 'ativo', reason: null };
  } catch (error) {
    if (!(error instanceof WhatsAppError)) throw error;
    const reason = CONNECTION_ERRORS[error.kind];
    await updateChannel(tx, channelId, {
      status: 'erro',
      statusReason: reason,
      lastCheckedAt: nowOf(deps),
    });
    return { status: 'erro', reason };
  }
}

/** Conecta (ou reconecta) o WhatsApp do escritório e dispara a submissão dos templates. */
export async function connectWhatsApp(
  ctx: TenantContext,
  deps: DeliveryDeps,
  input: ConnectInput,
): Promise<ConnectResult> {
  await requireConnectionManager(ctx);
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success)
    throw new ClientInputError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  const data = parsed.data;
  const webhookKey = randomBytes(32).toString('base64url');
  const verifyToken = randomBytes(24).toString('base64url');
  const encoder = new TextEncoder();

  return withTenant(ctx, async (tx) => {
    const existing = await findWhatsAppChannel(tx);
    let channelId: string;
    try {
      if (existing) {
        // Reconectar troca também a URL secreta e o verify token.
        await updateChannel(tx, existing.id, {
          appId: data.appId,
          wabaId: data.wabaId,
          phoneNumberId: data.phoneNumberId,
          status: 'pendente',
          webhookKeyHash: hashSecret(webhookKey),
          verifyTokenHash: hashSecret(verifyToken),
        });
        channelId = existing.id;
      } else {
        channelId = (
          await insertChannel(tx, ctx.tenantId, {
            appId: data.appId,
            wabaId: data.wabaId,
            phoneNumberId: data.phoneNumberId,
            webhookKeyHash: hashSecret(webhookKey),
            verifyTokenHash: hashSecret(verifyToken),
          })
        ).id;
      }
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === '23505')
        throw new ClientInputError('Este número já está conectado em outro escritório.');
      throw error;
    }
    await upsertCredential(
      tx,
      ctx.tenantId,
      channelId,
      'whatsapp_token',
      await deps.cipher.encrypt(encoder.encode(data.accessToken), ctx.tenantId),
    );
    await upsertCredential(
      tx,
      ctx.tenantId,
      channelId,
      'whatsapp_app_secret',
      await deps.cipher.encrypt(encoder.encode(data.appSecret), ctx.tenantId),
    );
    const check = await checkConnection(tx, ctx, deps, channelId);
    if (check.status === 'ativo') {
      await enqueue(deps.boss, ctx, tx, 'templates.sync', { channelId });
    }
    await recordAudit(tx, ctx, {
      action: existing ? 'whatsapp.reconectado' : 'whatsapp.conectado',
      resourceType: 'channel',
      resourceId: channelId,
      metadata: { status: check.status },
    });
    return {
      webhookPath: `/api/webhooks/whatsapp/${webhookKey}`,
      verifyToken,
      status: check.status,
      statusReason: check.reason,
    };
  });
}

export async function testWhatsAppConnection(
  ctx: TenantContext,
  deps: DeliveryDeps,
): Promise<{ status: 'ativo' | 'erro'; reason: string | null }> {
  await requireConnectionManager(ctx);
  return withTenant(ctx, async (tx) => {
    const channel = await findWhatsAppChannel(tx);
    if (!channel) throw new ClientInputError('O WhatsApp ainda não foi conectado.');
    const result = await checkConnection(tx, ctx, deps, channel.id);
    if (result.status === 'ativo') {
      await enqueue(deps.boss, ctx, tx, 'templates.sync', { channelId: channel.id });
    }
    return result;
  });
}

/** Situação da conexão e dos templates, sem nenhum segredo. */
export async function getWhatsAppStatus(ctx: TenantContext) {
  await requireConnectionManager(ctx);
  return withTenant(ctx, async (tx) => {
    const channel = await findWhatsAppChannel(tx);
    if (!channel) return null;
    // Só o que a tela precisa: nenhum hash de segredo sai daqui.
    const safe = {
      id: channel.id,
      appId: channel.appId,
      wabaId: channel.wabaId,
      phoneNumberId: channel.phoneNumberId,
      displayPhone: channel.displayPhone,
      verifiedName: channel.verifiedName,
      qualityRating: channel.qualityRating,
      status: channel.status,
      statusReason: channel.statusReason,
      lastCheckedAt: channel.lastCheckedAt,
    };
    return { channel: safe, templates: await listTenantTemplates(tx, channel.id) };
  });
}

/**
 * Submete a biblioteca ao WABA do escritório e grava o status (job templates.sync).
 * Template já aprovado na mesma versão não é submetido de novo.
 */
export async function syncTemplates(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  channelId: string,
): Promise<void> {
  const { connection } = await loadConnection(tx, ctx, deps.cipher, channelId);
  const { slug } = await tenantInfo(ctx);
  const current = new Map(
    (await listTenantTemplates(tx, channelId)).map((t) => [`${t.key}:${t.version}`, t]),
  );
  for (const lib of await listLibrary(tx)) {
    const def = TEMPLATE_LIBRARY[lib.key as TemplateKey];
    if (!def || def.version !== lib.version) continue;
    const existing = current.get(`${lib.key}:${lib.version}`);
    if (existing && (existing.status === 'aprovado' || existing.status === 'enviado')) continue;
    const name = metaTemplateName(def);
    try {
      // Já existe no WABA (ex.: reconexão): só lê o status; senão, submete.
      let submitted: { templateId: string; status: string; reason: string | null } | null =
        await deps.whatsapp.getTemplate(connection, name);
      if (!submitted) {
        const created = await deps.whatsapp.submitTemplate(connection, def, {
          name,
          linkBaseUrl: deps.portalOrigin(slug),
        });
        submitted = { templateId: created.templateId, status: created.status, reason: null };
      }
      await upsertTenantTemplate(tx, ctx.tenantId, {
        channelId,
        libraryId: lib.id,
        metaName: name,
        metaTemplateId: submitted.templateId,
        status: mapTemplateStatus(submitted.status),
        reason: submitted.reason,
      });
    } catch (error) {
      if (!(error instanceof WhatsAppError)) throw error;
      await upsertTenantTemplate(tx, ctx.tenantId, {
        channelId,
        libraryId: lib.id,
        metaName: name,
        metaTemplateId: null,
        status: 'rejeitado',
        reason: CONNECTION_ERRORS[error.kind],
      });
    }
  }
}
