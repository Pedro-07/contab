/** Papéis do escritório (RN10). */
export const ROLES = ['dono', 'admin', 'contador', 'atendente'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** MFA obrigatório para dono e admin (P14). */
export function roleRequiresMfa(role: Role): boolean {
  return role === 'dono' || role === 'admin';
}

/** Dono e admin gerenciam membros e convites; contador e atendente, não. */
export function canManageMembers(role: Role): boolean {
  return role === 'dono' || role === 'admin';
}

/** Dono e admin veem a auditoria do escritório. */
export function canViewAudit(role: Role): boolean {
  return role === 'dono' || role === 'admin';
}

/** Só o dono convida ou promove outro dono. */
export function canGrantRole(actor: Role, granted: Role): boolean {
  if (!canManageMembers(actor)) return false;
  if (granted === 'dono') return actor === 'dono';
  return true;
}

export type MemberChangeDenial = 'sem_permissao' | 'ultimo_dono' | 'alvo_dono';

/**
 * Mudança de papel de um membro existente.
 * - quem altera precisa poder conceder o papel novo;
 * - só o dono mexe em outro dono;
 * - o último dono não pode ser rebaixado.
 */
export function checkRoleChange(input: {
  actor: Role;
  from: Role;
  to: Role;
  activeOwners: number;
}): MemberChangeDenial | null {
  const { actor, from, to, activeOwners } = input;
  if (!canGrantRole(actor, to)) return 'sem_permissao';
  if (from === 'dono' && actor !== 'dono') return 'alvo_dono';
  if (from === 'dono' && to !== 'dono' && activeOwners <= 1) return 'ultimo_dono';
  return null;
}

/** Remoção de um membro: mesmas regras, e o último dono nunca sai. */
export function checkMemberRemoval(input: {
  actor: Role;
  target: Role;
  activeOwners: number;
}): MemberChangeDenial | null {
  const { actor, target, activeOwners } = input;
  if (!canManageMembers(actor)) return 'sem_permissao';
  if (target === 'dono' && actor !== 'dono') return 'alvo_dono';
  if (target === 'dono' && activeOwners <= 1) return 'ultimo_dono';
  return null;
}
