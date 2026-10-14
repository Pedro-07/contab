import type { EmailSender } from '@contab/adapters/email';
import { sendInvitationEmail } from '@contab/core';
import { defineJob, type JobDefinition } from '../define-job';

export type WorkerDeps = { email: EmailSender; painelUrl: string };

/** Todos os jobs do worker. Cada um passa pelo envelope de defineJob. */
export function createJobs(deps: WorkerDeps): JobDefinition[] {
  return [
    defineJob('invitation.send-email', (tx, ctx, payload) =>
      sendInvitationEmail(tx, ctx, deps, payload.invitationId),
    ),
  ];
}
