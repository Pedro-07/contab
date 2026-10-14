import type { EmailSender } from '@contab/adapters/email';
import {
  findActiveMembershipByUser,
  getInvitation,
  insertInvitation,
  listInvitations,
  markInvitationAccepted,
  recordAudit,
  revokeInvitation as revokeInvitationRow,
  setInvitationToken,
  upsertMembership,
  withTenant,
  type Invitation,
  type TenantContext,
  type TenantTx,
} from '@contab/db';
import {
  findTenantById,
  findUserByEmail,
  insertUser,
  lookupInvitation,
  recordSecurityEvent,
} from '@contab/db/global';
import { enqueue } from '@contab/db/queue';
import {
  asUserId,
  canGrantRole,
  canManageMembers,
  invitationExpiresAt,
  isInvitationUsable,
  isRole,
  normalizeEmail,
  type TenantId,
} from '@contab/domain';
import { createHash, randomBytes } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { actorRole, deny, logNotFound } from './guard';

export class InvalidInvitationError extends Error {
  constructor() {
    super('Convite inválido, expirado ou já usado.');
    this.name = 'InvalidInvitationError';
  }
}

export class InvitationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationInputError';
  }
}

/** Token de 256 bits. Só o hash vai para o banco. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function requireInviter(ctx: TenantContext, role?: string) {
  const actor = actorRole(ctx);
  if (!actor || !canManageMembers(actor))
    return deny(ctx, 'Seu papel não permite convidar.', 'invitation');
  if (role !== undefined && (!isRole(role) || !canGrantRole(actor, role))) {
    return deny(ctx, 'Seu papel não permite convidar com esse papel.', 'invitation');
  }
  return actor;
}

export async function listTenantInvitations(ctx: TenantContext): Promise<Invitation[]> {
  await requireInviter(ctx);
  return withTenant(ctx, (tx) => listInvitations(tx));
}

/** Cria o convite e enfileira o envio na mesma transação. O token nasce no job. */
export async function createInvitation(
  ctx: TenantContext,
  boss: PgBoss,
  input: { email: string; role: string },
): Promise<Invitation> {
  await requireInviter(ctx, input.role);
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    throw new InvitationInputError('E-mail inválido.');
  }
  const role = input.role as Invitation['role'];

  const existingUser = await findUserByEmail(email);
  return withTenant(ctx, async (tx) => {
    if (existingUser && (await findActiveMembershipByUser(tx, asUserId(existingUser.id)))) {
      throw new InvitationInputError('Essa pessoa já é membro do escritório.');
    }
    const invitation = await insertInvitation(tx, {
      tenantId: ctx.tenantId,
      email,
      role,
      invitedByUserId: ctx.actor.type === 'member' ? ctx.actor.userId : null,
      expiresAt: invitationExpiresAt(new Date()),
    });
    await enqueue(boss, ctx, tx, 'invitation.send-email', { invitationId: invitation.id });
    await recordAudit(tx, ctx, {
      action: 'convite.criado',
      resourceType: 'invitation',
      resourceId: invitation.id,
      metadata: { papel: role },
    });
    return invitation;
  });
}

/** Reenvia: o job gera um token novo, e o link anterior deixa de valer. */
export async function resendInvitation(
  ctx: TenantContext,
  boss: PgBoss,
  invitationId: string,
): Promise<void> {
  await requireInviter(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      const invitation = await getInvitation(tx, invitationId);
      if (invitation.acceptedAt || invitation.revokedAt) {
        throw new InvitationInputError('Este convite não pode mais ser reenviado.');
      }
      await enqueue(boss, ctx, tx, 'invitation.send-email', { invitationId });
      await recordAudit(tx, ctx, {
        action: 'convite.reenviado',
        resourceType: 'invitation',
        resourceId: invitationId,
      });
    }),
  );
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string): Promise<void> {
  await requireInviter(ctx);
  await logNotFound(ctx, () =>
    withTenant(ctx, async (tx) => {
      await revokeInvitationRow(tx, invitationId);
      await recordAudit(tx, ctx, {
        action: 'convite.revogado',
        resourceType: 'invitation',
        resourceId: invitationId,
      });
    }),
  );
}

/**
 * Handler do job invitation.send-email. Gera o token, grava só o hash, renova a validade
 * de 72 h e envia o e-mail. Se o envio falhar, a transação desfaz e o job tenta de novo.
 */
export async function sendInvitationEmail(
  tx: TenantTx,
  ctx: TenantContext,
  deps: { email: EmailSender; painelUrl: string },
  invitationId: string,
): Promise<void> {
  const invitation = await getInvitation(tx, invitationId);
  if (invitation.acceptedAt || invitation.revokedAt) return;

  const tenant = await findTenantById(ctx.tenantId);
  const { token, hash } = newInvitationToken();
  await setInvitationToken(tx, invitationId, hash, invitationExpiresAt(new Date()));

  const url = `${deps.painelUrl}/convite/${token}`;
  await deps.email.send({
    to: invitation.email,
    subject: `Convite para ${tenant?.name ?? 'o escritório'}`,
    text: [
      `Você foi convidado para a equipe de ${tenant?.name ?? 'um escritório'} na plataforma.`,
      '',
      'Para aceitar, abra o link abaixo. Ele vale por 72 horas e só funciona uma vez.',
      '',
      url,
    ].join('\n'),
  });
  await recordAudit(tx, ctx, {
    action: 'convite.enviado',
    resourceType: 'invitation',
    resourceId: invitationId,
  });
}

export type InvitationPreview = { tenantName: string; email: string; role: Invitation['role'] };

/** Mostra o convite antes do aceite. O tenant vem do segredo, nunca do navegador. */
export async function previewInvitation(
  token: string,
  meta: { requestId: string; ip: string | null },
) {
  const found = await lookupInvitation(hashInvitationToken(token));
  if (!found) {
    await recordSecurityEvent({
      type: 'invitation_invalid',
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return null;
  }
  const ctx = systemContext(found.tenantId, meta, 'convite.visualizar');
  const invitation = await withTenant(ctx, (tx) => getInvitation(tx, found.invitationId));
  const tenant = await findTenantById(found.tenantId);
  return {
    tenantName: tenant?.name ?? '',
    email: invitation.email,
    role: invitation.role,
  } satisfies InvitationPreview;
}

/**
 * Aceita o convite: cria (ou reaproveita) o usuário do e-mail convidado e a membership.
 * A posse do token prova o e-mail. Uso único: o primeiro aceite marca o convite, e um
 * segundo aceite concorrente desfaz a própria transação.
 */
export async function acceptInvitation(
  token: string,
  meta: { requestId: string; ip: string | null },
): Promise<{ email: string; tenantId: TenantId }> {
  const found = await lookupInvitation(hashInvitationToken(token));
  if (!found) {
    await recordSecurityEvent({
      type: 'invitation_invalid',
      ip: meta.ip,
      requestId: meta.requestId,
    });
    throw new InvalidInvitationError();
  }

  const systemCtx = systemContext(found.tenantId, meta, 'convite.aceitar');
  const invitation = await withTenant(systemCtx, (tx) => getInvitation(tx, found.invitationId));
  if (!isInvitationUsable(invitation, new Date())) throw new InvalidInvitationError();

  const user =
    (await findUserByEmail(invitation.email)) ?? (await insertUser({ email: invitation.email }));
  const userId = asUserId(user.id);
  const memberCtx: TenantContext = {
    tenantId: found.tenantId,
    actor: { type: 'member', userId, role: invitation.role },
    requestId: meta.requestId,
    ip: meta.ip,
  };

  await withTenant(memberCtx, async (tx) => {
    await markInvitationAccepted(tx, invitation.id, userId);
    const membershipId = await upsertMembership(tx, found.tenantId, userId, invitation.role);
    await recordAudit(tx, memberCtx, {
      action: 'convite.aceito',
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { papel: invitation.role },
    });
  }).catch((error) => {
    throw error instanceof Error && error.name === 'NotFoundError'
      ? new InvalidInvitationError()
      : error;
  });

  return { email: invitation.email, tenantId: found.tenantId };
}

function systemContext(
  tenantId: TenantId,
  meta: { requestId: string; ip: string | null },
  jobName: string,
): TenantContext {
  return {
    tenantId,
    actor: { type: 'system', jobName, jobId: meta.requestId },
    requestId: meta.requestId,
    ip: meta.ip,
  };
}
