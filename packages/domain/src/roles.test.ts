import { describe, expect, it } from 'vitest';
import {
  canGrantRole,
  canManageMembers,
  checkMemberRemoval,
  checkRoleChange,
  roleRequiresMfa,
} from './roles';

describe('papéis (RN10)', () => {
  it('MFA é obrigatório só para dono e admin', () => {
    expect(roleRequiresMfa('dono')).toBe(true);
    expect(roleRequiresMfa('admin')).toBe(true);
    expect(roleRequiresMfa('contador')).toBe(false);
    expect(roleRequiresMfa('atendente')).toBe(false);
  });

  it('contador e atendente não gerenciam membros', () => {
    expect(canManageMembers('contador')).toBe(false);
    expect(canManageMembers('atendente')).toBe(false);
  });

  it('admin não concede o papel de dono; dono concede', () => {
    expect(canGrantRole('admin', 'dono')).toBe(false);
    expect(canGrantRole('admin', 'contador')).toBe(true);
    expect(canGrantRole('dono', 'dono')).toBe(true);
    expect(canGrantRole('atendente', 'atendente')).toBe(false);
  });

  it('o último dono não pode ser rebaixado', () => {
    expect(checkRoleChange({ actor: 'dono', from: 'dono', to: 'admin', activeOwners: 1 })).toBe(
      'ultimo_dono',
    );
    expect(
      checkRoleChange({ actor: 'dono', from: 'dono', to: 'admin', activeOwners: 2 }),
    ).toBeNull();
  });

  it('admin não mexe em dono', () => {
    expect(checkRoleChange({ actor: 'admin', from: 'dono', to: 'contador', activeOwners: 2 })).toBe(
      'alvo_dono',
    );
    expect(checkMemberRemoval({ actor: 'admin', target: 'dono', activeOwners: 2 })).toBe(
      'alvo_dono',
    );
  });

  it('o último dono nunca é removido', () => {
    expect(checkMemberRemoval({ actor: 'dono', target: 'dono', activeOwners: 1 })).toBe(
      'ultimo_dono',
    );
  });

  it('contador não remove ninguém', () => {
    expect(checkMemberRemoval({ actor: 'contador', target: 'atendente', activeOwners: 1 })).toBe(
      'sem_permissao',
    );
  });
});
