import { openSecureLink } from '@contab/core';
import { asTenantId, formatCents } from '@contab/domain';
import QRCode from 'qrcode';
import { formatIsoDate } from '@/lib/labels';
import { getRequestMeta } from '@/server/painel';
import { getPortalTenant } from '@/server/portal';
import { CopyButton } from './copy-button';

/**
 * Link seguro sem login (RN14): Pix com QR, linha digitável e PDF. O escritório vem do
 * subdomínio; link de outro escritório, vencido ou além do limite não mostra nada da guia.
 */
export default async function LinkSeguroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await getPortalTenant();
  const view = await openSecureLink(asTenantId(tenant.id), token, await getRequestMeta());

  if (view.state !== 'ok') {
    const message = {
      invalido: 'Este link não existe ou não é deste escritório.',
      expirado: 'Este link venceu. Peça um novo ao escritório.',
      limite: 'Este link já foi aberto muitas vezes. Peça um novo ao escritório.',
      paga: 'Esta guia já está paga. Obrigado!',
      substituida: 'Esta guia foi substituída por uma atualizada. Confira a mensagem mais recente.',
      cancelada: 'Esta guia foi cancelada pelo escritório.',
    }[view.state];
    return (
      <main>
        <h1>{tenant.name}</h1>
        <p role="status">{message}</p>
      </main>
    );
  }

  const qr = view.pixCode ? await QRCode.toDataURL(view.pixCode, { margin: 1, width: 240 }) : null;
  return (
    <main>
      <p className="muted">{tenant.name}</p>
      <h1>
        Guia {view.typeLabel} · {view.period}
      </h1>
      <p>{view.companyName}</p>
      <dl className="facts">
        <dt>Valor</dt>
        <dd>
          <strong>{formatCents(view.amountCents)}</strong>
        </dd>
        <dt>Vencimento</dt>
        <dd>{formatIsoDate(view.dueDate)}</dd>
      </dl>
      {view.overdue && (
        <p role="alert" className="alert">
          Esta guia venceu. Fale com o escritório antes de pagar: pode ser preciso atualizar o
          valor.
        </p>
      )}
      {view.pixCode && qr && (
        <section className="card" aria-labelledby="pix">
          <h2 id="pix">Pagar com Pix</h2>
          {/* O QR é gerado no servidor; o código Pix não vai para serviço de terceiros. */}
          <img src={qr} alt="QR code do Pix" width={240} height={240} />
          <p className="code">{view.pixCode}</p>
          <CopyButton text={view.pixCode} label="Copiar código Pix" />
        </section>
      )}
      {view.barcode && (
        <section className="card" aria-labelledby="boleto">
          <h2 id="boleto">Linha digitável</h2>
          <p className="code">{view.barcode}</p>
          <CopyButton text={view.barcode} label="Copiar linha digitável" />
        </section>
      )}
      {view.hasPdf && (
        <p>
          <a className="button" href={`/g/${token}/pdf`}>
            Baixar a guia em PDF
          </a>
        </p>
      )}
    </main>
  );
}
