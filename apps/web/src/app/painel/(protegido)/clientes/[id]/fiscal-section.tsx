import { getCompanyFiscalStatus } from '@contab/core';
import { formatPeriod, GUIDE_TYPE_LABEL } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { formatDateTime } from '@/lib/labels';
import { checkNowAction } from './fiscal-actions';

const WATCH_STATUS = {
  aguardando: 'Aguardando a declaração',
  gerada: 'Guia gerada; acompanhando o pagamento',
  revisao: 'Guia saiu, mas precisa de revisão',
  paga: 'Paga',
  desistiu: 'Encerrada sem guia ou sem pagamento',
} as const;

/** Rotina fiscal da empresa no mês (incremento 4): situação e "Buscar agora". */
export async function FiscalSection({
  ctx,
  companyId,
  canCheck,
}: {
  ctx: Parameters<typeof getCompanyFiscalStatus>[0];
  companyId: string;
  canCheck: boolean;
}) {
  const status = await getCompanyFiscalStatus(ctx, companyId);
  return (
    <section aria-labelledby="receita">
      <h2 id="receita">Receita Federal</h2>
      {!status.connected && (
        <p role="status">
          A Receita não está conectada. Conecte em <a href="/conexoes/receita">Conexões</a> para as
          guias saírem sozinhas.
        </p>
      )}
      {status.connected && status.watches.length === 0 && (
        <p role="status">A rotina deste mês ainda não começou para esta empresa.</p>
      )}
      {status.watches.length > 0 && (
        <ul>
          {status.watches.map((w) => (
            <li key={w.id}>
              {GUIDE_TYPE_LABEL[w.kind]} de {formatPeriod(w.period)}:{' '}
              <strong>{WATCH_STATUS[w.status]}</strong>
              {w.guideId && (
                <>
                  {' '}
                  · <a href={`/guias/${w.guideId}`}>ver guia</a>
                </>
              )}
              {w.lastError && <span className="muted"> ({w.lastError})</span>}
              {w.lastCheckedAt && (
                <span className="muted"> · consultado em {formatDateTime(w.lastCheckedAt)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {status.connected && canCheck && (
        <ActionForm action={checkNowAction} submitLabel="Buscar agora" variant="secondary">
          <input type="hidden" name="companyId" value={companyId} />
        </ActionForm>
      )}
    </section>
  );
}
