import { listClientCompanies } from '@contab/core';
import { canEditClients, COMPANY_STATUSES, formatCnpj, isOneOf, TAX_REGIMES } from '@contab/domain';
import { COMPANY_STATUS_LABEL, REGIME_LABEL } from '@/lib/labels';
import { requirePainel } from '@/server/painel';

const PAGE_SIZE = 50;

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, organization } = await requirePainel();
  const params = await searchParams;
  const search = (params.q ?? '').slice(0, 100);
  const status = isOneOf(COMPANY_STATUSES, params.status) ? params.status : undefined;
  const regime = isOneOf(TAX_REGIMES, params.regime) ? params.regime : undefined;
  const page = Math.max(1, Number.parseInt(params.pagina ?? '1', 10) || 1);

  const { rows, total } = await listClientCompanies(ctx, {
    search,
    ...(status ? { status } : {}),
    ...(regime ? { regime } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (search) q.set('q', search);
    if (status) q.set('status', status);
    if (regime) q.set('regime', regime);
    q.set('pagina', String(p));
    return `/clientes?${q}`;
  };

  return (
    <main>
      <h1>Clientes</h1>
      {canEditClients(organization.role) && (
        <p className="row">
          <a className="button" href="/clientes/nova">
            Nova empresa
          </a>
          <a className="button secondary" href="/clientes/importar">
            Importar CSV
          </a>
        </p>
      )}

      <form method="get" action="/clientes" className="filters" role="search">
        <div>
          <label htmlFor="q">Buscar por nome ou CNPJ</label>
          <input id="q" name="q" type="search" defaultValue={search} />
        </div>
        <div>
          <label htmlFor="status">Situação</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Todas</option>
            {COMPANY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMPANY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="regime">Regime</label>
          <select id="regime" name="regime" defaultValue={regime ?? ''}>
            <option value="">Todos</option>
            {TAX_REGIMES.map((r) => (
              <option key={r} value={r}>
                {REGIME_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="secondary">
          Filtrar
        </button>
      </form>

      <p role="status" className="muted">
        {total === 0
          ? search || status || regime
            ? 'Nenhuma empresa encontrada com esses filtros.'
            : 'Nenhuma empresa cadastrada ainda.'
          : `${total} empresa${total === 1 ? '' : 's'}`}
      </p>

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">CNPJ</th>
              <th scope="col">Regime</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td data-label="Empresa">
                  <a href={`/clientes/${c.id}`}>{c.tradeName || c.legalName}</a>
                  {c.tradeName && <div className="muted">{c.legalName}</div>}
                </td>
                <td data-label="CNPJ" className="code">
                  {formatCnpj(c.cnpj)}
                </td>
                <td data-label="Regime">{REGIME_LABEL[c.regime]}</td>
                <td data-label="Situação">{COMPANY_STATUS_LABEL[c.status]}</td>
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
