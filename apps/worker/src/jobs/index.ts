import type { EmailSender } from '@contab/adapters/email';
import type { FileStorage } from '@contab/adapters/storage';
import { sendInvitationEmail, verifyDocumentVersion } from '@contab/core';
import { defineJob, type JobDefinition } from '../define-job';

export type WorkerDeps = { email: EmailSender; painelUrl: string; storage: FileStorage };

/** Todos os jobs do worker. Cada um passa pelo envelope de defineJob. */
export function createJobs(deps: WorkerDeps): JobDefinition[] {
  return [
    defineJob('invitation.send-email', (tx, ctx, payload) =>
      sendInvitationEmail(tx, ctx, deps, payload.invitationId),
    ),
    defineJob('document.verify', async (tx, ctx, payload) => {
      await verifyDocumentVersion(tx, ctx, deps.storage, payload.versionId);
    }),
  ];
}
