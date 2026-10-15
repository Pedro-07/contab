import { listTenantAlerts } from '@contab/core';
import { canManageGuides } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { formatDateTime, ROLE_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { resolveAlertAction } from './alert-actions';

export default async function InicioPage() {
  const { ctx, organization } = await requirePainel();
  const alerts = await listTenantAlerts(ctx);
  return (
    <main>
      <h1>{organization.name}</h1>
      <p>
        Você está como <strong>{ROLE_LABEL[organization.role]}</strong>.
      </p>
      <section aria-labelledby="alertas">
        <h2 id="alertas">Alertas</h2>
        {alerts.length === 0 && <p role="status">Nenhum alerta aberto.</p>}
        <ul className="docs">
          {alerts.map((a) => (
            <li key={a.id} className="card">
              <p>{a.message}</p>
              <p className="muted">{formatDateTime(a.createdAt)}</p>
              {a.resourceType === 'guide' && a.resourceId && (
                <p>
                  <a href={`/guias/${a.resourceId}`}>Ver a guia</a>
                </p>
              )}
              {canManageGuides(organization.role) && (
                <ActionForm
                  action={resolveAlertAction}
                  submitLabel="Marcar como resolvido"
                  variant="secondary"
                >
                  <input type="hidden" name="alertId" value={a.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>
      <p className="row">
        <a href="/guias">Guias</a>
        <a href="/clientes">Clientes e documentos</a>
      </p>
    </main>
  );
}
