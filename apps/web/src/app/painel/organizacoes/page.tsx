import { listMyOrganizations, withUser } from '@contab/db';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { ROLE_LABEL } from '@/lib/labels';
import { getPainelState } from '@/server/painel';
import { switchOrganizationAction } from './actions';

export default async function OrganizacoesPage() {
  const state = await getPainelState();
  if (state.kind === 'anonimo') redirect('/entrar');

  const { userId } = state.session;
  const organizations =
    state.kind === 'sem_organizacao'
      ? state.organizations
      : await withUser(userId, (tx) => listMyOrganizations(tx, userId));
  const activeId = state.kind === 'sem_organizacao' ? null : state.organization.tenantId;

  return (
    <main>
      <h1>Escolha o escritório</h1>
      {organizations.length === 0 && (
        <p role="status">
          Você não participa de nenhum escritório. Peça um convite ao dono do escritório.
        </p>
      )}
      {organizations.map((org) => (
        <div key={org.tenantId} className="card">
          <p>
            <strong>{org.name}</strong> <span className="muted">· {ROLE_LABEL[org.role]}</span>
            {org.tenantId === activeId && <span className="muted"> · ativo</span>}
          </p>
          <ActionForm
            action={switchOrganizationAction}
            submitLabel={`Entrar em ${org.name}`}
            variant="secondary"
          >
            <input type="hidden" name="tenantId" value={org.tenantId} />
          </ActionForm>
        </div>
      ))}
    </main>
  );
}
