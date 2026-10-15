/**
 * Entrega automática (RN13, P25, ADR 0008). Um item publicado vira uma entrega por contato
 * e canal; cada entrega é um job idempotente. O status da guia é conferido logo antes de
 * cada envio (RN8). WhatsApp que não pode sair desvia para o e-mail e avisa o escritório (CA9).
 */
import { classifyError, mapTemplateStatus, WhatsAppError } from '@contab/adapters/whatsapp';
import {
  findWhatsAppChannel,
  getCompany,
  getContact,
  getDelivery,
  getDocument,
  getGuide,
  insertDeliveryIfAbsent,
  insertSecureLink,
  listCompanyContacts,
  listCompanyDocuments,
  listTenantTemplates,
  NotFoundError,
  raiseAlert,
  setTemplateStatusByMeta,
  updateDelivery,
  findDeliveryByProviderId,
  getTenantSettings,
  type Delivery,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import { enqueue } from '@contab/db/queue';
import {
  chooseChannels,
  formatCents,
  formatPeriod,
  GUIDE_TYPE_LABEL,
  isPayableGuide,
  metaTemplateName,
  renderTemplate,
  TEMPLATE_LIBRARY,
  templateValues,
  type TemplateKey,
} from '@contab/domain';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { loadConnection, nowOf, tenantInfo, type DeliveryDeps } from './delivery-deps';

export const SECURE_LINK_DAYS = 30;
const MAX_ATTEMPTS = 5;

type ItemType = Delivery['itemType'];
type Trigger = Delivery['trigger'];

export function templateFor(itemType: ItemType, trigger: Trigger): TemplateKey {
  if (itemType === 'documento') return 'documento_disponivel';
  return (
    {
      publicacao: 'guia_disponivel',
      lembrete: 'lembrete_vencimento',
      vencida: 'guia_vencida',
      pago: 'pagamento_confirmado',
    } as const
  )[trigger];
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token de descadastro do e-mail: ID do contato assinado com o segredo da plataforma. */
export function emailOptOutToken(secret: string, tenantId: string, contactId: string): string {
  const sig = createHmac('sha256', secret)
    .update(`${tenantId}:${contactId}:email-opt-out`)
    .digest('base64url');
  return `${contactId}.${sig}`;
}

/** WhatsApp pronto para este template: conexão ativa e template aprovado e ligado. */
async function whatsappReadyFor(tx: TenantTx, key: TemplateKey): Promise<boolean> {
  const channel = await findWhatsAppChannel(tx);
  if (!channel || channel.status !== 'ativo') return false;
  const templates = await listTenantTemplates(tx, channel.id);
  return templates.some(
    (t) =>
      t.key === key &&
      t.status === 'aprovado' &&
      t.enabled &&
      t.version === TEMPLATE_LIBRARY[key].version,
  );
}

/** Job delivery.plan: cria as entregas de um item para os contatos da empresa. */
export async function planDeliveries(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  item: { itemType: ItemType; itemId: string; trigger: Trigger },
): Promise<number> {
  let companyId: string;
  let pdfReady = true;
  if (item.itemType === 'guia') {
    const guide = await getGuide(tx, item.itemId).catch(() => null);
    if (!guide) return 0;
    if (item.trigger !== 'pago' && !isPayableGuide(guide.status)) return 0;
    companyId = guide.companyId;
  } else {
    const doc = await getDocument(tx, item.itemId).catch(() => null);
    if (!doc) return 0;
    companyId = doc.companyId;
    const current = (await listCompanyDocuments(tx, companyId)).find(
      (d) => d.id === doc.id,
    )?.current;
    if (!current) return 0;
    // O cabeçalho do template aceita PDF; imagem vai só por e-mail.
    pdfReady = current.contentType === 'application/pdf';
  }

  const key = templateFor(item.itemType, item.trigger);
  const whatsappReady = pdfReady && (await whatsappReadyFor(tx, key));
  let created = 0;
  for (const contact of await listCompanyContacts(tx, companyId)) {
    if (!contact.receivesDeliveries) continue;
    const choice = chooseChannels({
      preferred: contact.preferredChannel,
      phone: contact.phone,
      email: contact.email,
      whatsappOptIn: Boolean(contact.whatsappOptInAt),
      emailOptIn: Boolean(contact.emailOptInAt),
      whatsappReady,
    });
    if (choice.whatsappSkipped === 'indisponivel') {
      await raiseAlert(tx, ctx.tenantId, {
        kind: 'whatsapp_indisponivel',
        message:
          'O WhatsApp não está pronto (conexão ou template pendente). Os envios estão saindo por e-mail.',
        resourceType: 'template',
        resourceId: key,
      });
    }
    for (const channel of choice.channels) {
      const delivery = await insertDeliveryIfAbsent(tx, ctx.tenantId, {
        itemType: item.itemType,
        itemId: item.itemId,
        companyId,
        contactId: contact.contactId,
        channel,
        trigger: item.trigger,
        templateKey: key,
      });
      if (delivery) {
        await enqueue(deps.boss, ctx, tx, 'delivery.send', { deliveryId: delivery.id });
        created++;
      }
    }
  }
  return created;
}

type Content = {
  values: Record<string, string>;
  pdf: { key: string; fileName: string } | null;
  linkToken: string | null;
};

async function buildContent(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  d: Delivery,
  contactName: string,
): Promise<Content | null> {
  const office = await tenantInfo(ctx);
  const company = await getCompany(tx, d.companyId);
  const empresa = company.tradeName || company.legalName;
  const contato = contactName.split(' ')[0] ?? contactName;

  if (d.itemType === 'documento') {
    const doc = await getDocument(tx, d.itemId);
    const current = (await listCompanyDocuments(tx, d.companyId)).find(
      (x) => x.id === doc.id,
    )?.current;
    if (!current) return null;
    return {
      values: { contato, escritorio: office.name, documento: doc.title, empresa },
      pdf: { key: current.storageKey, fileName: current.originalName },
      linkToken: null,
    };
  }

  const guide = await getGuide(tx, d.itemId);
  const vencimento = `${guide.dueDate.slice(8, 10)}/${guide.dueDate.slice(5, 7)}/${guide.dueDate.slice(0, 4)}`;
  let linkToken: string | null = null;
  if (d.trigger !== 'pago') {
    linkToken = randomBytes(32).toString('base64url');
    await insertSecureLink(tx, ctx.tenantId, {
      tokenHash: hashLinkToken(linkToken),
      itemId: guide.id,
      expiresAt: new Date(nowOf(deps).getTime() + SECURE_LINK_DAYS * 86_400_000),
    });
  }
  return {
    values: {
      contato,
      escritorio: office.name,
      tipo: GUIDE_TYPE_LABEL[guide.type],
      empresa,
      competencia: formatPeriod(guide.period),
      valor: formatCents(guide.amountCents),
      vencimento,
    },
    pdf:
      d.trigger === 'publicacao' && guide.pdfStorageKey
        ? {
            key: guide.pdfStorageKey,
            fileName: `guia-${guide.type}-${formatPeriod(guide.period).replace('/', '-')}.pdf`,
          }
        : null,
    linkToken,
  };
}

/** Cria a entrega por e-mail que substitui um WhatsApp que não saiu, e avisa o escritório. */
async function fallbackToEmail(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  d: Delivery,
  reason: string,
): Promise<void> {
  await raiseAlert(tx, ctx.tenantId, {
    kind: 'whatsapp_falhou',
    message: `Um envio pelo WhatsApp não saiu (${reason}). Quando há e-mail, ele foi usado no lugar.`,
    resourceType: 'delivery',
    resourceId: d.id,
  });
  const contact = await getContact(tx, d.contactId);
  if (!contact.email || !contact.emailOptInAt) return;
  const email = await insertDeliveryIfAbsent(tx, ctx.tenantId, {
    itemType: d.itemType,
    itemId: d.itemId,
    companyId: d.companyId,
    contactId: d.contactId,
    channel: 'email',
    trigger: d.trigger,
    templateKey: d.templateKey,
    fallbackOf: d.id,
  });
  if (email) await enqueue(deps.boss, ctx, tx, 'delivery.send', { deliveryId: email.id });
}

const WHATSAPP_REASONS: Record<WhatsAppError['kind'], string> = {
  template_indisponivel: 'template pausado ou desativado pela Meta',
  destinatario: 'número inválido ou sem WhatsApp',
  credencial: 'a conexão do WhatsApp perdeu o acesso',
  limite: 'limite de envios da Meta',
  outro: 'erro da Meta',
};

/** Job delivery.send. Idempotente: só age sobre entrega ainda na fila. */
export async function sendDelivery(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  deliveryId: string,
): Promise<Delivery['status'] | 'ignorado'> {
  const d = await getDelivery(tx, deliveryId).catch((e) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  if (!d || d.status !== 'enfileirado') return 'ignorado';

  // RN8: guia paga, cancelada ou substituída não recebe lembrete nem aviso.
  if (d.itemType === 'guia' && d.trigger !== 'pago') {
    const guide = await getGuide(tx, d.itemId);
    if (!isPayableGuide(guide.status)) {
      await updateDelivery(tx, d.id, { status: 'cancelado', failureReason: 'guia_nao_pagavel' });
      return 'cancelado';
    }
  }

  const contact = await getContact(tx, d.contactId);
  const authorized =
    d.channel === 'whatsapp'
      ? Boolean(contact.phone && contact.whatsappOptInAt)
      : Boolean(contact.email && contact.emailOptInAt);
  if (!authorized) {
    await updateDelivery(tx, d.id, { status: 'cancelado', failureReason: 'sem_autorizacao' });
    return 'cancelado';
  }

  const def = TEMPLATE_LIBRARY[d.templateKey as TemplateKey];
  const content = await buildContent(tx, ctx, deps, d, contact.name);
  if (!def || !content) {
    await updateDelivery(tx, d.id, { status: 'falhou', failureReason: 'item_indisponivel' });
    return 'falhou';
  }
  const values = templateValues(def, content.values);
  const office = await tenantInfo(ctx);
  const linkUrl = content.linkToken
    ? `${deps.portalOrigin(office.slug)}/g/${content.linkToken}`
    : null;

  if (d.channel === 'email') {
    const settings = await getTenantSettings(tx);
    const optOut = `${deps.portalOrigin(office.slug)}/sair-email/${emailOptOutToken(deps.linkSecret, ctx.tenantId, contact.id)}`;
    const pdf = content.pdf ? await deps.storage.readAll(ctx.tenantId, content.pdf.key) : null;
    await deps.email.send({
      to: contact.email!,
      subject: renderTemplate(def.emailSubject, values),
      text: [
        renderTemplate(def.body, values),
        ...(linkUrl ? ['', `Ver a guia, o Pix e a linha digitável: ${linkUrl}`] : []),
        '',
        `Enviado por ${office.name}. Para não receber mais estes e-mails: ${optOut}`,
      ].join('\n'),
      fromName: office.name,
      ...(settings?.replyToEmail ? { replyTo: settings.replyToEmail } : {}),
      ...(pdf && content.pdf
        ? {
            attachments: [
              { fileName: content.pdf.fileName, contentType: 'application/pdf', content: pdf },
            ],
          }
        : {}),
      idempotencyKey: `delivery-${d.id}`,
    });
    await updateDelivery(tx, d.id, {
      status: 'enviado',
      attempts: d.attempts + 1,
      sentAt: nowOf(deps),
    });
    return 'enviado';
  }

  // WhatsApp
  const channel = await findWhatsAppChannel(tx);
  if (!channel || channel.status !== 'ativo') {
    await updateDelivery(tx, d.id, { status: 'falhou', failureReason: 'whatsapp_desconectado' });
    await fallbackToEmail(tx, ctx, deps, d, 'conexão do WhatsApp inativa');
    return 'falhou';
  }
  try {
    const { connection } = await loadConnection(tx, ctx, deps.cipher, channel.id);
    let document;
    if (def.header === 'document' && content.pdf) {
      const bytes = await deps.storage.readAll(ctx.tenantId, content.pdf.key);
      const mediaId = await deps.whatsapp.uploadMedia(connection, {
        bytes,
        contentType: 'application/pdf',
        fileName: content.pdf.fileName,
      });
      document = { mediaId, fileName: content.pdf.fileName };
    }
    const { messageId } = await deps.whatsapp.sendTemplate(connection, {
      to: contact.phone!,
      templateName: metaTemplateName(def),
      language: def.language,
      category: def.category,
      bodyValues: values,
      ...(document ? { document } : {}),
      ...(content.linkToken && def.linkButton ? { linkSuffix: content.linkToken } : {}),
    });
    await updateDelivery(tx, d.id, {
      status: 'enviado',
      attempts: d.attempts + 1,
      providerMessageId: messageId,
      sentAt: nowOf(deps),
    });
    return 'enviado';
  } catch (error) {
    if (!(error instanceof WhatsAppError)) throw error;
    const attempts = d.attempts + 1;
    if (!error.permanent && attempts < MAX_ATTEMPTS) {
      // Erro temporário: nova tentativa agendada na mesma transação (30 s, 60 s, 120 s…).
      await updateDelivery(tx, d.id, { attempts, failureReason: WHATSAPP_REASONS[error.kind] });
      await enqueue(
        deps.boss,
        ctx,
        tx,
        'delivery.send',
        { deliveryId: d.id },
        { startAfterSeconds: 30 * 2 ** (attempts - 1) },
      );
      return 'enfileirado';
    }
    await updateDelivery(tx, d.id, {
      status: 'falhou',
      attempts,
      failureReason: WHATSAPP_REASONS[error.kind],
    });
    if (error.kind === 'template_indisponivel') {
      await setTemplateStatusByMeta(
        tx,
        channel.id,
        { name: metaTemplateName(def) },
        'pausado',
        null,
      );
    }
    await fallbackToEmail(tx, ctx, deps, d, WHATSAPP_REASONS[error.kind]);
    return 'falhou';
  }
}

const STATUS_RANK = { enfileirado: 0, enviado: 1, entregue: 2, lido: 3 } as const;

/**
 * Status vindo do webhook da Meta: entregue, lido ou falhou. Nunca anda para trás.
 * Falha informada pela Meta desvia para o e-mail (CA9).
 */
export async function applyWhatsAppStatus(
  tx: TenantTx,
  ctx: TenantContext,
  deps: DeliveryDeps,
  status: { messageId: string; status: string; timestamp: Date; errorCode: number | null },
): Promise<void> {
  const d = await findDeliveryByProviderId(tx, status.messageId);
  if (!d) return;
  if (status.status === 'failed') {
    if (d.status === 'falhou' || d.status === 'cancelado') return;
    const reason = WHATSAPP_REASONS[classifyError(status.errorCode, 400).kind];
    await updateDelivery(tx, d.id, { status: 'falhou', failureReason: reason });
    await fallbackToEmail(tx, ctx, deps, d, reason);
    return;
  }
  const next =
    status.status === 'read' ? 'lido' : status.status === 'delivered' ? 'entregue' : null;
  if (!next || !(d.status in STATUS_RANK)) return;
  if (STATUS_RANK[next] <= STATUS_RANK[d.status as keyof typeof STATUS_RANK]) return;
  await updateDelivery(tx, d.id, {
    status: next,
    ...(next === 'entregue' ? { deliveredAt: status.timestamp } : { readAt: status.timestamp }),
  });
}

/** Template pausado, rejeitado ou reativado pela Meta (webhook): status e alerta (CA9). */
export async function applyTemplateStatus(
  tx: TenantTx,
  ctx: TenantContext,
  channelId: string,
  event: { templateId: string; name: string; status: string; reason: string | null },
): Promise<void> {
  const status = mapTemplateStatus(event.status);
  const updated = await setTemplateStatusByMeta(
    tx,
    channelId,
    { templateId: event.templateId, name: event.name },
    status,
    event.reason,
  );
  if (updated && (status === 'pausado' || status === 'rejeitado' || status === 'desativado')) {
    await raiseAlert(tx, ctx.tenantId, {
      kind: 'template_indisponivel',
      message: `A Meta ${status === 'rejeitado' ? 'rejeitou' : 'pausou'} o modelo de mensagem "${updated.key}". Esses envios vão sair por e-mail.`,
      resourceType: 'template',
      resourceId: updated.key,
    });
  }
}
