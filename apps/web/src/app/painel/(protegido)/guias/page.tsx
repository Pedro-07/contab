import { listTenantGuides } from '@contab/core';
import {
  canManageGuides,
  formatCents,
  formatPeriod,
  GUIDE_STATUSES,
  GUIDE_TYPES,
  isOneOf,
  isUuid,
} from '@contab/domain';
import { formatIsoDate, GUIDE_STATUS_LABEL, GUIDE_TYPE_NAME } from '@/lib/labels';
import { requirePainel } from '@/server/painel';

const PAGE_SIZE = 50;

export default async function GuiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, organization } = await requirePainel();
  const params = await searchParams;
  const status = isOneOf(GUIDE_STATUSES, params.status) ? params.status : undefined;
  const type = isOneOf(GUIDE_TYPES, params.tipo) ? params.tipo : undefined;
  const companyId = isUuid(params.empresa) ? params.empresa : undefined;
  const page = Math.max(1, Number.parseInt(params.pagina ?? '1', 10) || 1);
  const { rows, total } = await listTenantGuides(ctx, {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(companyId ? { companyId } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (type) q.set('tipo', type);
    if (companyId) q.set('empresa', companyId);
    q.set('pagina', String(p));
    return `/guias?${q}`;
  };

  return (
    <main>
      <h1>Guias</h1>
      {canManageGuides(organization.role) && (
        <p>
          <a className="button" href="/guias/nova">
            Nova guia avulsa
          </a>
        </p>
      )}
      <form method="get" action="/guias" className="filters">
        {companyId && <input type="hidden" name="empresa" value={companyId} />}
        <div>
          <label htmlFor="status">Situação</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Todas</option>
            {GUIDE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {GUIDE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tipo">Tipo</label>
          <select id="tipo" name="tipo" defaultValue={type ?? ''}>
            <option value="">Todos</option>
            {GUIDE_TYPES.map((t) => (
              <option key={t} value={t}>
                {GUIDE_TYPE_NAME[t]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="secondary">
          Filtrar
        </button>
      </form>

      <p role="status" className="muted">
        {total === 0 ? 'Nenhuma guia encontrada.' : `${total} guia${total === 1 ? '' : 's'}`}
      </p>
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">Guia</th>
              <th scope="col">Valor</th>
              <th scope="col">Vencimento</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td data-label="Empresa">{g.companyName}</td>
                <td data-label="Guia">
                  <a href={`/guias/${g.id}`}>
                    {GUIDE_TYPE_NAME[g.type]} {formatPeriod(g.period)}
                  </a>
                </td>
                <td data-label="Valor">{formatCents(g.amountCents)}</td>
                <td data-label="Vencimento">{formatIsoDate(g.dueDate)}</td>
                <td data-label="Situação">{GUIDE_STATUS_LABEL[g.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <nav aria-label="Páginas" className="row">
          {page > 1 && <a href={link(page - 1)}>Anterior</a>}
          <span>
            Página {page} de {pages}
          </span>
          {page < pages && <a href={link(page + 1)}>Próxima</a>}
        </nav>
      )}
    </main>
  );
}
