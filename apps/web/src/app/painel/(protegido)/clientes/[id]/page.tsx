import { getCompanyProfile } from '@contab/core';
import { NotFoundError } from '@contab/db';
import {
  canEditClients,
  canManageDocuments,
  CONTACT_ROLES,
  DOCUMENT_CATEGORIES,
  formatCnpj,
  formatPhone,
  PREFERRED_CHANNELS,
} from '@contab/domain';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import {
  CATEGORY_LABEL,
  CHANNEL_LABEL,
  COMPANY_STATUS_LABEL,
  CONTACT_ROLE_LABEL,
  formatBytes,
  formatDate,
  POA_STATUS_LABEL,
  REGIME_LABEL,
  REJECTION_LABEL,
  VERSION_STATUS_LABEL,
} from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import {
  addContactAction,
  deleteDocumentAction,
  editCompanyAction,
  portalAccessAction,
  removeContactAction,
  setCompanyStatusAction,
  visibilityAction,
} from '../actions';
import { CompanyFields } from '../company-fields';
import { RefreshWhilePending, UploadForm } from './upload-form';

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, organization } = await requirePainel();
  const profile = await getCompanyProfile(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { company, contacts, documents } = profile;
  const canEdit = canEditClients(organization.role);
  const canDocs = canManageDocuments(organization.role);
  const verifying = documents.some((d) => d.latest?.status === 'verificando');

  return (
    <main>
      <p>
        <a href="/clientes">← Clientes</a>
      </p>
      <h1>{company.tradeName || company.legalName}</h1>
      <p className="muted">
        <span className="code">{formatCnpj(company.cnpj)}</span> · {REGIME_LABEL[company.regime]} ·{' '}
        {COMPANY_STATUS_LABEL[company.status]}
      </p>

      <section aria-labelledby="dados">
        <h2 id="dados">Dados da empresa</h2>
        <dl className="facts">
          <dt>Razão social</dt>
          <dd>{company.legalName}</dd>
          <dt>Inscrição estadual</dt>
          <dd>{company.stateRegistration || '—'}</dd>
          <dt>Procuração (e-CAC)</dt>
          <dd>
            {POA_STATUS_LABEL[company.poaStatus]}
            {company.poaValidUntil &&
              ` até ${formatDate(new Date(`${company.poaValidUntil}T12:00:00Z`))}`}
          </dd>
        </dl>
        {canEdit && (
          <>
            <details>
              <summary>Editar dados</summary>
              <ActionForm action={editCompanyAction} submitLabel="Salvar">
                <input type="hidden" name="companyId" value={company.id} />
                <CompanyFields company={company} />
              </ActionForm>
            </details>
            <ActionForm
              action={setCompanyStatusAction}
              submitLabel={company.status === 'ativa' ? 'Inativar empresa' : 'Reativar empresa'}
              variant="secondary"
            >
              <input type="hidden" name="companyId" value={company.id} />
              <input
                type="hidden"
                name="status"
                value={company.status === 'ativa' ? 'inativa' : 'ativa'}
              />
            </ActionForm>
          </>
        )}
      </section>

      <section aria-labelledby="contatos">
        <h2 id="contatos">Contatos</h2>
        {contacts.length === 0 && <p role="status">Nenhum contato ligado a esta empresa.</p>}
        {contacts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Papel</th>
                <th scope="col">Telefone e e-mail</th>
                <th scope="col">Autorizações</th>
                <th scope="col">Portal</th>
                {canEdit && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.linkId}>
                  <td data-label="Nome">
                    <a href={`/clientes/contatos/${c.contactId}`}>{c.name}</a>
                  </td>
                  <td data-label="Papel">{CONTACT_ROLE_LABEL[c.role]}</td>
                  <td data-label="Telefone e e-mail">
                    {c.phone && <div>{formatPhone(c.phone)}</div>}
                    {c.email && <div>{c.email}</div>}
                    <div className="muted">Prefere {CHANNEL_LABEL[c.preferredChannel]}</div>
                  </td>
                  <td data-label="Autorizações">
                    <div>WhatsApp: {c.whatsappOptInAt ? 'sim' : 'não'}</div>
                    <div>E-mail: {c.emailOptInAt ? 'sim' : 'não'}</div>
                    <div>Recebe envios: {c.receivesDeliveries ? 'sim' : 'não'}</div>
                  </td>
                  <td data-label="Portal">{c.portalAccess ? 'Com acesso' : 'Sem acesso'}</td>
                  {canEdit && (
                    <td data-label="Ações">
                      <ActionForm
                        action={portalAccessAction}
                        submitLabel={
                          c.portalAccess ? 'Tirar acesso ao portal' : 'Dar acesso ao portal'
                        }
                        variant="secondary"
                      >
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="contactId" value={c.contactId} />
                        <input type="hidden" name="grant" value={c.portalAccess ? 'nao' : 'sim'} />
                      </ActionForm>
                      <ActionForm
                        action={removeContactAction}
                        submitLabel="Desvincular"
                        variant="danger"
                      >
                        <input type="hidden" name="companyId" value={company.id} />
                        <input type="hidden" name="contactId" value={c.contactId} />
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details className="card">
            <summary>Adicionar contato</summary>
            <ActionForm action={addContactAction} submitLabel="Adicionar contato">
              <input type="hidden" name="companyId" value={company.id} />
              <label htmlFor="c-name">Nome</label>
              <input id="c-name" name="name" required autoComplete="off" />
              <label htmlFor="c-phone">Telefone (WhatsApp)</label>
              <input id="c-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" />
              <label htmlFor="c-email">E-mail</label>
              <input id="c-email" name="email" type="email" autoComplete="off" />
              <label htmlFor="c-role">Papel</label>
              <select id="c-role" name="role" defaultValue="socio">
                {CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {CONTACT_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <label htmlFor="c-channel">Canal preferido</label>
              <select id="c-channel" name="preferredChannel" defaultValue="whatsapp">
                {PREFERRED_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {CHANNEL_LABEL[ch]}
                  </option>
                ))}
              </select>
              <fieldset>
                <legend>Autorizações</legend>
                <label className="check">
                  <input type="checkbox" name="whatsappOptIn" /> Autorizou receber WhatsApp do
                  escritório
                </label>
                <label className="check">
                  <input type="checkbox" name="emailOptIn" /> Autorizou receber e-mail do escritório
                </label>
                <label className="check">
                  <input type="checkbox" name="receivesDeliveries" defaultChecked /> Recebe as guias
                  e documentos desta empresa
                </label>
                <label className="check">
                  <input type="checkbox" name="portalAccess" /> Acessa esta empresa no portal
                </label>
              </fieldset>
            </ActionForm>
          </details>
        )}
      </section>

      <section aria-labelledby="documentos">
        <h2 id="documentos">Documentos</h2>
        <RefreshWhilePending pending={verifying} />
        {documents.length === 0 && <p role="status">Nenhum documento ainda.</p>}
        {DOCUMENT_CATEGORIES.map((category) => {
          const inFolder = documents.filter((d) => d.category === category);
          if (inFolder.length === 0) return null;
          return (
            <div key={category} className="folder">
              <h3>{CATEGORY_LABEL[category]}</h3>
              <ul className="docs">
                {inFolder.map((d) => (
                  <li key={d.id} className="card">
                    <div className="row">
                      <strong>{d.title}</strong>
                      <span className="muted">
                        {d.visibleToClient ? 'Visível para o cliente' : 'Só para o escritório'}
                      </span>
                    </div>
                    {d.current ? (
                      <p>
                        <a href={`/documentos/${d.id}/baixar`}>Baixar {d.current.originalName}</a>{' '}
                        <span className="muted">
                          (versão {d.current.version}, {formatBytes(d.current.sizeBytes)},{' '}
                          {formatDate(d.current.createdAt)})
                        </span>
                      </p>
                    ) : (
                      <p className="muted">Ainda sem arquivo disponível.</p>
                    )}
                    {d.latest && d.latest.status !== 'disponivel' && (
                      <p
                        role="status"
                        className={d.latest.status === 'rejeitado' ? 'alert' : 'muted'}
                      >
                        Versão {d.latest.version}: {VERSION_STATUS_LABEL[d.latest.status]}
                        {d.latest.rejectionReason &&
                          ` (${REJECTION_LABEL[d.latest.rejectionReason] ?? d.latest.rejectionReason})`}
                      </p>
                    )}
                    {d.versions.filter((v) => v.status === 'disponivel').length > 1 && (
                      <details>
                        <summary>Versões anteriores</summary>
                        <ul>
                          {d.versions
                            .filter((v) => v.status === 'disponivel' && v.id !== d.current?.id)
                            .map((v) => (
                              <li key={v.id}>
                                <a href={`/documentos/${d.id}/baixar?versao=${v.id}`}>
                                  Versão {v.version}: {v.originalName}
                                </a>{' '}
                                <span className="muted">({formatDate(v.createdAt)})</span>
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                    {canDocs && (
                      <details>
                        <summary>Alterar</summary>
                        <UploadForm
                          companyId={company.id}
                          documentId={d.id}
                          label="Enviar nova versão"
                        />
                        <div className="row">
                          <ActionForm
                            action={visibilityAction}
                            submitLabel={
                              d.visibleToClient ? 'Esconder do cliente' : 'Mostrar ao cliente'
                            }
                            variant="secondary"
                          >
                            <input type="hidden" name="companyId" value={company.id} />
                            <input type="hidden" name="documentId" value={d.id} />
                            <input
                              type="hidden"
                              name="visible"
                              value={d.visibleToClient ? 'nao' : 'sim'}
                            />
                          </ActionForm>
                          <ActionForm
                            action={deleteDocumentAction}
                            submitLabel="Excluir documento"
                            variant="danger"
                          >
                            <input type="hidden" name="companyId" value={company.id} />
                            <input type="hidden" name="documentId" value={d.id} />
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {canDocs && (
          <div className="card">
            <h3>Novo documento</h3>
            <UploadForm companyId={company.id} label="Enviar documento" />
          </div>
        )}
      </section>
    </main>
  );
}
