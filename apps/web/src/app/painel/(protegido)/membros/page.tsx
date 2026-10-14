import { listTeam } from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { ROLES } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { ROLE_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { changeRoleAction, removeMemberAction } from './actions';

export default async function MembrosPage() {
  const { ctx, session } = await requirePainel();
  const members = await listTeam(ctx).catch((error) => {
    if (error instanceof ForbiddenError) return null;
    throw error;
  });

  if (!members) {
    return (
      <main>
        <h1>Membros</h1>
        <p role="alert">Seu papel não permite gerenciar membros.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Membros</h1>
      {members.length === 0 && <p role="status">Nenhum membro.</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">E-mail</th>
            <th scope="col">Papel</th>
            <th scope="col">Verificação em duas etapas</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td data-label="E-mail">
                {m.email}
                {m.userId === session.userId && <span className="muted"> (você)</span>}
              </td>
              <td data-label="Papel">{ROLE_LABEL[m.role]}</td>
              <td data-label="Duas etapas">{m.twoFactorEnabled ? 'Ativa' : 'Não configurada'}</td>
              <td data-label="Ações">
                <ActionForm
                  action={changeRoleAction}
                  submitLabel="Alterar papel"
                  variant="secondary"
                >
                  <input type="hidden" name="membershipId" value={m.id} />
                  <label htmlFor={`role-${m.id}`} className="sr-only">
                    Novo papel de {m.email}
                  </label>
                  <select id={`role-${m.id}`} name="role" defaultValue={m.role}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </ActionForm>
                <ActionForm action={removeMemberAction} submitLabel="Remover" variant="danger">
                  <input type="hidden" name="membershipId" value={m.id} />
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
