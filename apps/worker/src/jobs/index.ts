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
import { defineJob, type JobDefinition } from '../define-job';

export type WorkerDeps = DeliveryDeps & {
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
  ];
}
