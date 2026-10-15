/**
 * Dependências dos casos de uso de conexão, guias e entrega (incremento 3). A web e o
 * worker montam com os adaptadores reais; os testes, com o WhatsApp simulado.
 */
import type { Cipher } from '@contab/adapters/crypto';
import type { EmailSender } from '@contab/adapters/email';
import type { FileStorage } from '@contab/adapters/storage';
import type { WhatsAppConnection, WhatsAppProvider } from '@contab/adapters/whatsapp';
import {
  getChannel,
  getCredentials,
  NotFoundError,
  type Channel,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { findTenantById } from '@contab/db/global';
import type { PgBoss } from 'pg-boss';

export type DeliveryDeps = {
  boss: PgBoss;
  storage: FileStorage;
  whatsapp: WhatsAppProvider;
  email: EmailSender;
  cipher: Cipher;
  /** Origem do portal do escritório, ex.: https://contact.exemplo.com.br */
  portalOrigin: (slug: string) => string;
  /** Segredo da plataforma para assinar o link de descadastro do e-mail (RN7). */
  linkSecret: string;
  now?: () => Date;
};

/** Origem do portal de cada escritório: mesmo protocolo do painel, host <slug>.<domínio>. */
export function portalOriginFrom(painelUrl: string, baseDomain: string): (slug: string) => string {
  const protocol = new URL(painelUrl).protocol;
  return (slug) => `${protocol}//${slug}.${baseDomain}`;
}

export function nowOf(deps: Pick<DeliveryDeps, 'now'>): Date {
  return deps.now ? deps.now() : new Date();
}

export async function tenantInfo(ctx: TenantContext): Promise<{ name: string; slug: string }> {
  const tenant = await findTenantById(ctx.tenantId);
  if (!tenant) throw new NotFoundError('tenant', ctx.tenantId);
  return { name: tenant.name, slug: tenant.slug };
}

const decoder = new TextDecoder();

/** Conexão com os segredos decifrados, só em memória (ADR 0006). */
export async function loadConnection(
  tx: TenantTx,
  ctx: TenantContext,
  cipher: Cipher,
  channelId: string,
): Promise<{ channel: Channel; connection: WhatsAppConnection; appSecret: string }> {
  const channel = await getChannel(tx, channelId);
  const secrets = await getCredentials(tx, channel.id);
  if (!secrets.whatsapp_token || !secrets.whatsapp_app_secret)
    throw new NotFoundError('credential', channel.id);
  const accessToken = decoder.decode(await cipher.decrypt(secrets.whatsapp_token, ctx.tenantId));
  const appSecret = decoder.decode(await cipher.decrypt(secrets.whatsapp_app_secret, ctx.tenantId));
  return {
    channel,
    connection: {
      appId: channel.appId,
      wabaId: channel.wabaId,
      phoneNumberId: channel.phoneNumberId,
      accessToken,
    },
    appSecret,
  };
}
