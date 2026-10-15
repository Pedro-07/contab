import type { ReactNode } from 'react';
import { canManageConnections, canManageMembers, canViewAudit } from '@contab/domain';
import { ROLE_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { signOutAction } from './actions';

/** Toda página daqui para baixo exige sessão, organização ativa e segundo fator. */
export default async function ProtegidoLayout({ children }: { children: ReactNode }) {
  const { organization, session } = await requirePainel();
  return (
    <>
      <nav className="top" aria-label="Principal">
        <strong>{organization.name}</strong>
        <a href="/">Início</a>
        <a href="/clientes">Clientes</a>
        <a href="/guias">Guias</a>
        {canManageMembers(organization.role) && <a href="/membros">Membros</a>}
        {canManageMembers(organization.role) && <a href="/convites">Convites</a>}
        {canViewAudit(organization.role) && <a href="/auditoria">Auditoria</a>}
        {canManageConnections(organization.role) && <a href="/conexoes">Conexões</a>}
        {canManageConnections(organization.role) && <a href="/configuracoes">Configurações</a>}
        <span className="spacer" />
        <a href="/organizacoes">Trocar escritório</a>
        <span className="muted">
          {session.email} · {ROLE_LABEL[organization.role]}
        </span>
        <form action={signOutAction}>
          <button type="submit" className="secondary">
            Sair
          </button>
        </form>
      </nav>
      {children}
    </>
  );
}
