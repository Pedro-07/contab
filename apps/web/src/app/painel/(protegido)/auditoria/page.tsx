import { listTenantAudit } from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { formatDateTime } from '@/lib/labels';
import { requirePainel } from '@/server/painel';

export default async function AuditoriaPage() {
  const { ctx } = await requirePainel();
  const entries = await listTenantAudit(ctx).catch((error) => {
    if (error instanceof ForbiddenError) return null;
    throw error;
  });

  return (
    <main>
      <h1>Auditoria</h1>
      {!entries && <p role="alert">Seu papel não permite ver a auditoria.</p>}
      {entries && entries.length === 0 && <p role="status">Nenhum registro.</p>}
      {entries && entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">Ação</th>
              <th scope="col">Quem</th>
              <th scope="col">Recurso</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td data-label="Quando">{formatDateTime(e.createdAt)}</td>
                <td data-label="Ação">{e.action}</td>
                <td data-label="Quem">{e.actorType === 'member' ? e.actorUserId : e.actorType}</td>
                <td data-label="Recurso">
                  {e.resourceType} {e.resourceId && <span className="code">{e.resourceId}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
