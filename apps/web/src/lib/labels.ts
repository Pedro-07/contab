import type { Role } from '@contab/domain';

export const ROLE_LABEL: Record<Role, string> = {
  dono: 'Dono',
  admin: 'Admin',
  contador: 'Contador',
  atendente: 'Atendente',
};

export const INVITATION_STATUS_LABEL = {
  pendente: 'Pendente',
  aceito: 'Aceito',
  revogado: 'Revogado',
  expirado: 'Expirado',
  aguardando_envio: 'Enviando',
} as const;

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(date);
}
