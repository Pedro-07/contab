import type { EmailSender } from '@contab/adapters/email';
import type { FileStorage } from '@contab/adapters/storage';
import {
  planDeliveries,
  processWebhookEvent,
  runRegua,
  sendDelivery,
  sendInvitationEmail,
  syncTemplates,
  verifyDocumentVersion,
  type DeliveryDeps,
} from '@contab/core';
import {
  runSerproConnect,
  runSerproRecalc,
  runSerproTenant,
  runSerproWatch,
  type FiscalDeps,
} from '@contab/core/serpro-worker';
import { defineJob, type JobDefinition } from '../define-job';

export type WorkerDeps = DeliveryDeps &
  FiscalDeps & {
    email: EmailSender;
    painelUrl: string;
    storage: FileStorage;
  };

/** Todos os jobs de tenant do worker. Cada um passa pelo envelope de defineJob. */
export function createJobs(deps: WorkerDeps): JobDefinition[] {
  return [
    defineJob('invitation.send-email', (tx, ctx, payload) =>
      sendInvitationEmail(tx, ctx, deps, payload.invitationId),
    ),
    defineJob('document.verify', async (tx, ctx, payload) => {
      await verifyDocumentVersion(tx, ctx, deps.storage, payload.versionId, deps.boss);
    }),
    defineJob('delivery.plan', async (tx, ctx, payload) => {
      await planDeliveries(tx, ctx, deps, payload);
    }),
    defineJob('delivery.send', async (tx, ctx, payload) => {
      await sendDelivery(tx, ctx, deps, payload.deliveryId);
    }),
    defineJob('regua.tenant', async (tx, ctx) => {
      await runRegua(tx, ctx, deps);
    }),
    defineJob('webhook.meta.process', (tx, ctx, payload) =>
      processWebhookEvent(tx, ctx, deps, payload.eventId),
    ),
    defineJob('templates.sync', (tx, ctx, payload) =>
      syncTemplates(tx, ctx, deps, payload.channelId),
    ),
    // Serpro (incremento 4): erro da Receita não lança; a rotina agenda a próxima tentativa.
    defineJob('serpro.connect', async (tx, ctx, payload) => {
      await runSerproConnect(tx, ctx, deps, payload.connectionId);
    }),
    defineJob('serpro.tenant', async (tx, ctx) => {
      await runSerproTenant(tx, ctx, deps);
    }),
    defineJob('serpro.watch', async (tx, ctx, payload) => {
      await runSerproWatch(tx, ctx, deps, payload.watchId, payload.trigger);
    }),
    defineJob('serpro.recalc', async (tx, ctx, payload) => {
      await runSerproRecalc(tx, ctx, deps, payload);
    }),
  ];
}
