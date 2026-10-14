import { describe, expect, it } from 'vitest';
import {
  INVITATION_TTL_MS,
  invitationExpiresAt,
  invitationStatus,
  normalizeEmail,
} from './invitations';

const now = new Date('2026-10-26T12:00:00Z');
const base = {
  expiresAt: invitationExpiresAt(now),
  acceptedAt: null,
  revokedAt: null,
  tokenHash: 'h',
};

describe('convites', () => {
  it('expiram em 72 h', () => {
    expect(base.expiresAt.getTime() - now.getTime()).toBe(INVITATION_TTL_MS);
    expect(invitationStatus(base, new Date(now.getTime() + INVITATION_TTL_MS))).toBe('expirado');
  });

  it('aceito ou revogado deixa de ser utilizável', () => {
    expect(invitationStatus({ ...base, acceptedAt: now }, now)).toBe('aceito');
    expect(invitationStatus({ ...base, revokedAt: now }, now)).toBe('revogado');
  });

  it('sem token ainda não foi enviado', () => {
    expect(invitationStatus({ ...base, tokenHash: null }, now)).toBe('aguardando_envio');
  });

  it('normaliza o e-mail', () => {
    expect(normalizeEmail('  Maria@Contact.COM.br ')).toBe('maria@contact.com.br');
    expect(() => normalizeEmail('sem-arroba')).toThrow();
  });
});
