import { listPortalDocuments } from '@contab/core';
import { DOCUMENT_CATEGORIES, formatCnpj } from '@contab/domain';
import { CATEGORY_LABEL, formatDate } from '@/lib/labels';
import { getPortalState, getPortalTenant } from '@/server/portal';

/**
 * Portal do cliente (incremento 2). O escritório vem do subdomínio; a pessoa, do cookie.
 * Mostra só a empresa ativa (CA6).
 */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const tenant = await getPortalTenant();
  const state = await getPortalState();
  const params = await searchParams;

  if (!state) {
    return (
      <main>
        <h1>{tenant.name}</h1>
        {params.link === 'invalido' && (
          <p role="alert" className="alert">
            Este link de acesso não vale mais.
          </p>
        )}
        <p>As guias e os documentos chegam pelo WhatsApp ou pelo e-mail.</p>
        <p>
          <a className="button" href="/entrar">
            Entrar com o código no WhatsApp
          </a>
        </p>
        <p className="muted">Use para buscar guias e documentos antigos.</p>
      </main>
    );
  }

  const documents = await listPortalDocuments(state);
  const active = state.activeCompany;

  return (
    <>
      <nav className="top" aria-label="Portal">
        <strong>{tenant.name}</strong>
        <span className="spacer" />
        <span className="muted">{state.contactName}</span>
        <form method="post" action="/sair">
          <button type="submit" className="secondary">
            Sair
          </button>
        </form>
      </nav>
      <main>
        {params.empresa === 'negada' && (
          <p role="alert" className="alert">
            Você não tem acesso a essa empresa.
          </p>
        )}

        {state.companies.length === 0 && (
          <p role="status">Nenhuma empresa liberada para você. Fale com o escritório.</p>
        )}

        {state.companies.length > 1 && (
          <form method="post" action="/empresa" className="card">
            <label htmlFor="companyId">Empresa</label>
            <select id="companyId" name="companyId" defaultValue={active?.companyId ?? ''} required>
              <option value="" disabled>
                Escolha a empresa
              </option>
              {state.companies.map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {c.tradeName || c.legalName}
                </option>
              ))}
            </select>
            <button type="submit">{active ? 'Trocar de empresa' : 'Entrar na empresa'}</button>
          </form>
        )}

        {active && (
          <section aria-labelledby="empresa-ativa">
            <h1 id="empresa-ativa">{active.tradeName || active.legalName}</h1>
            <p className="muted code">{formatCnpj(active.cnpj)}</p>
            <h2>Documentos</h2>
            {documents.length === 0 && <p role="status">Nenhum documento disponível.</p>}
            {DOCUMENT_CATEGORIES.map((category) => {
              const inFolder = documents.filter((d) => d.category === category);
              if (inFolder.length === 0) return null;
              return (
                <div key={category}>
                  <h3>{CATEGORY_LABEL[category]}</h3>
                  <ul className="docs">
                    {inFolder.map((d) => (
                      <li key={d.id} className="card">
                        <a href={`/documentos/${d.id}`}>{d.title}</a>{' '}
                        {d.current && (
                          <span className="muted">({formatDate(d.current.createdAt)})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </>
  );
}
