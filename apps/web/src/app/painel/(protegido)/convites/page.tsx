import { listTenantInvitations } from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { canGrantRole, invitationStatus, ROLES } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { formatDateTime, INVITATION_STATUS_LABEL, ROLE_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { createInvitationAction, resendInvitationAction, revokeInvitationAction } from './actions';

export default async function ConvitesPage() {
  const { ctx, organization } = await requirePainel();
  const invitations = await listTenantInvitations(ctx).catch((error) => {
    if (error instanceof ForbiddenError) return null;
    throw error;
  });

  if (!invitations) {
    return (
      <main>
        <h1>Convites</h1>
        <p role="alert">Seu papel não permite convidar.</p>
      </main>
    );
  }

  const now = new Date();
  const grantable = ROLES.filter((r) => canGrantRole(organization.role, r));

  return (
    <main>
      <h1>Convites</h1>
      <div className="card">
        <h2>Novo convite</h2>
        <ActionForm action={createInvitationAction} submitLabel="Enviar convite">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoComplete="off" />
          <label htmlFor="role">Papel</label>
          <select id="role" name="role" defaultValue="atendente">
            {grantable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <p className="muted">O convite vale por 72 horas.</p>
        </ActionForm>
      </div>

      <h2>Enviados</h2>
      {invitations.length === 0 && <p role="status">Nenhum convite enviado.</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">E-mail</th>
            <th scope="col">Papel</th>
            <th scope="col">Situação</th>
            <th scope="col">Expira em</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => {
            const status = invitationStatus(inv, now);
            const open =
              status === 'pendente' || status === 'aguardando_envio' || status === 'expirado';
            return (
              <tr key={inv.id}>
                <td data-label="E-mail">{inv.email}</td>
                <td data-label="Papel">{ROLE_LABEL[inv.role]}</td>
                <td data-label="Situação">{INVITATION_STATUS_LABEL[status]}</td>
                <td data-label="Expira em">{formatDateTime(inv.expiresAt)}</td>
                <td data-label="Ações">
                  {open && (
                    <ActionForm
                      action={resendInvitationAction}
                      submitLabel="Reenviar"
                      variant="secondary"
                    >
                      <input type="hidden" name="invitationId" value={inv.id} />
                    </ActionForm>
                  )}
                  {(status === 'pendente' || status === 'aguardando_envio') && (
                    <ActionForm
                      action={revokeInvitationAction}
                      submitLabel="Revogar"
                      variant="danger"
                    >
                      <input type="hidden" name="invitationId" value={inv.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
