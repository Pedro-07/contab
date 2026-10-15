import { getContactProfile } from '@contab/core';
import { NotFoundError } from '@contab/db';
import { canEditClients, formatCnpj, formatPhone } from '@contab/domain';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { CHANNEL_LABEL, CONTACT_ROLE_LABEL, formatDateTime } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { consentAction } from '../../actions';

const SOURCE_LABEL = { importacao: 'importação', cadastro_manual: 'cadastro no painel' } as const;

export default async function ContatoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, organization } = await requirePainel();
  const { contact, companies, consents } = await getContactProfile(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canEdit = canEditClients(organization.role);
  const back = `/clientes/contatos/${contact.id}`;

  return (
    <main>
      <p>
        <a href="/clientes">← Clientes</a>
      </p>
      <h1>{contact.name}</h1>
      <dl className="facts">
        <dt>Telefone</dt>
        <dd>{contact.phone ? formatPhone(contact.phone) : '—'}</dd>
        <dt>E-mail</dt>
        <dd>{contact.email ?? '—'}</dd>
        <dt>Canal preferido</dt>
        <dd>{CHANNEL_LABEL[contact.preferredChannel]}</dd>
      </dl>

      <h2>Empresas</h2>
      {companies.length === 0 && <p role="status">Não está ligado a nenhuma empresa.</p>}
      <ul>
        {companies.map((c) => (
          <li key={c.companyId}>
            <a href={`/clientes/${c.companyId}`}>{c.legalName}</a>{' '}
            <span className="muted">
              ({formatCnpj(c.cnpj)}, {CONTACT_ROLE_LABEL[c.role]})
            </span>
          </li>
        ))}
      </ul>

      <h2>Autorização para receber mensagens</h2>
      {(['whatsapp', 'email'] as const).map((channel) => {
        const optIn = channel === 'whatsapp' ? contact.whatsappOptInAt : contact.emailOptInAt;
        return (
          <div key={channel} className="row">
            <span>
              {channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}:{' '}
              <strong>
                {optIn ? `autorizado em ${formatDateTime(optIn)}` : 'sem autorização'}
              </strong>
            </span>
            {canEdit && (
              <ActionForm
                action={consentAction}
                submitLabel={optIn ? 'Registrar retirada' : 'Registrar autorização'}
                variant="secondary"
              >
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="channel" value={channel} />
                <input type="hidden" name="optIn" value={optIn ? 'nao' : 'sim'} />
                <input type="hidden" name="back" value={back} />
              </ActionForm>
            )}
          </div>
        );
      })}

      <h2>Histórico de autorizações</h2>
      {consents.length === 0 && <p role="status">Nenhum registro.</p>}
      <ul>
        {consents.map((c) => (
          <li key={c.id}>
            {formatDateTime(c.occurredAt)}: {c.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}{' '}
            {c.status === 'opt_in' ? 'autorizado' : 'retirado'}, por {SOURCE_LABEL[c.source]}
          </li>
        ))}
      </ul>
    </main>
  );
}
