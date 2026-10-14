/** Convites expiram em 72 h e têm uso único (plano, seção 9). */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

export type InvitationState = {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  tokenHash: string | null;
};

export type InvitationStatus = 'pendente' | 'aceito' | 'revogado' | 'expirado' | 'aguardando_envio';

export function invitationStatus(inv: InvitationState, now: Date): InvitationStatus {
  if (inv.acceptedAt) return 'aceito';
  if (inv.revokedAt) return 'revogado';
  if (inv.expiresAt.getTime() <= now.getTime()) return 'expirado';
  if (!inv.tokenHash) return 'aguardando_envio';
  return 'pendente';
}

export function isInvitationUsable(inv: InvitationState, now: Date): boolean {
  return invitationStatus(inv, now) === 'pendente';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) throw new Error('e-mail inválido');
  return normalized;
}
