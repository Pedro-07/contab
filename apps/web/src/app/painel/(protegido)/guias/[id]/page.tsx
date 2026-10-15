import { getGuideDetail } from '@contab/core';
import { NotFoundError } from '@contab/db';
import { canManageGuides, formatCents, formatCnpj, formatPeriod } from '@contab/domain';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_TRIGGER_LABEL,
  formatDateTime,
  formatIsoDate,
  GUIDE_STATUS_LABEL,
  GUIDE_TYPE_NAME,
} from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { cancelGuideAction, markPaidAction, publishGuideAction } from '../actions';
import { GuidePdfForm } from './guide-pdf-form';

export default async function GuiaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, organization } = await requirePainel();
  const { guide, company, events, deliveries } = await getGuideDetail(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canEdit = canManageGuides(organization.role);
  const pdfReady = Boolean(guide.pdfStorageKey && guide.pdfSha256);
  const payable = guide.status !== 'paga' && guide.status !== 'cancelada';

  return (
    <main>
      <p>
        <a href={`/guias?empresa=${company.id}`}>← Guias da empresa</a>
      </p>
      <h1>
        {GUIDE_TYPE_NAME[guide.type]} {formatPeriod(guide.period)}
      </h1>
      <p className="muted">
        <a href={`/clientes/${company.id}`}>{company.tradeName || company.legalName}</a> ·{' '}
        <span className="code">{formatCnpj(company.cnpj)}</span>
      </p>
      <dl className="facts">
        <dt>Situação</dt>
        <dd>
          <strong>{GUIDE_STATUS_LABEL[guide.status]}</strong>
        </dd>
        <dt>Valor</dt>
        <dd>{formatCents(guide.amountCents)}</dd>
        <dt>Vencimento</dt>
        <dd>{formatIsoDate(guide.dueDate)}</dd>
        <dt>Linha digitável</dt>
        <dd className="code">{guide.barcode ?? '—'}</dd>
        <dt>Pix</dt>
        <dd>{guide.pixCode ? 'Informado' : '—'}</dd>
        <dt>PDF</dt>
        <dd>
          {pdfReady ? <a href={`/guias/${guide.id}/pdf`}>Baixar PDF</a> : 'Ainda não enviado'}
        </dd>
      </dl>

      {canEdit && guide.status === 'rascunho' && (
        <section className="card" aria-labelledby="publicar">
          <h2 id="publicar">Publicar</h2>
          <GuidePdfForm guideId={guide.id} hasPdf={pdfReady} />
          {pdfReady ? (
            <ActionForm action={publishGuideAction} submitLabel="Publicar e enviar ao cliente">
              <input type="hidden" name="guideId" value={guide.id} />
              <p className="muted">
                Ao publicar, cada contato da empresa que recebe envios recebe a guia pelo WhatsApp
                ou pelo e-mail.
              </p>
            </ActionForm>
          ) : (
            <p className="muted">Envie o PDF para poder publicar.</p>
          )}
        </section>
      )}

      {canEdit && payable && (
        <details className="card">
          <summary>Registrar pagamento</summary>
          <ActionForm action={markPaidAction} submitLabel="Confirmar pagamento">
            <input type="hidden" name="guideId" value={guide.id} />
            <label htmlFor="reason-paid">Como o pagamento foi confirmado?</label>
            <input id="reason-paid" name="reason" required minLength={3} maxLength={300} />
          </ActionForm>
        </details>
      )}
      {canEdit &&
        (guide.status === 'rascunho' ||
          guide.status === 'publicada' ||
          guide.status === 'vencida') && (
          <details className="card">
            <summary>Cancelar guia</summary>
            <ActionForm action={cancelGuideAction} submitLabel="Cancelar guia" variant="danger">
              <input type="hidden" name="guideId" value={guide.id} />
              <label htmlFor="reason-cancel">Motivo</label>
              <input id="reason-cancel" name="reason" required minLength={3} maxLength={300} />
            </ActionForm>
          </details>
        )}

      <section aria-labelledby="envios">
        <h2 id="envios">Envios</h2>
        {deliveries.length === 0 && <p role="status">Nenhum envio ainda.</p>}
        {deliveries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Contato</th>
                <th scope="col">Envio</th>
                <th scope="col">Canal</th>
                <th scope="col">Situação</th>
                <th scope="col">Quando</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td data-label="Contato">{d.contactName}</td>
                  <td data-label="Envio">{DELIVERY_TRIGGER_LABEL[d.trigger]}</td>
                  <td data-label="Canal">
                    {d.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                    {d.fallbackOf && <span className="muted"> (no lugar do WhatsApp)</span>}
                  </td>
                  <td data-label="Situação">
                    {DELIVERY_STATUS_LABEL[d.status]}
                    {d.failureReason && <div className="muted">{d.failureReason}</div>}
                  </td>
                  <td data-label="Quando">
                    {formatDateTime(d.readAt ?? d.deliveredAt ?? d.sentAt ?? d.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="historico">
        <h2 id="historico">Histórico</h2>
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              {formatDateTime(e.createdAt)}: {GUIDE_STATUS_LABEL[e.toStatus]}
              {e.reason && <span className="muted"> ({e.reason})</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
