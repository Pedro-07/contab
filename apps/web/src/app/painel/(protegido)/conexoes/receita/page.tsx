import { getFiscalConnectionView } from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { canManageConnections, formatCents } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { formatDateTime } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import {
  connectOwnAction,
  connectPlatformAction,
  disconnectFiscalAction,
  testFiscalAction,
} from './actions';

const STATUS = {
  pendente: 'Conferindo',
  ativa: 'Ativa',
  erro: 'Com erro',
  desconectada: 'Desconectada',
} as const;

const MODE = {
  plataforma: 'Pelo contrato da plataforma (termo de autorização)',
  proprio: 'Pelo contrato do próprio escritório',
} as const;

export default async function ReceitaPage() {
  const { ctx, organization } = await requirePainel();
  if (!canManageConnections(organization.role)) {
    return (
      <main>
        <h1>Conexões › Receita Federal</h1>
        <p role="alert">Seu papel não permite ver as conexões.</p>
      </main>
    );
  }
  const view = await getFiscalConnectionView(ctx).catch((error) => {
    if (error instanceof ForbiddenError) return null;
    throw error;
  });
  const c = view?.connection ?? null;
  return (
    <main>
      <p>
        <a href="/conexoes">← Conexões › WhatsApp</a>
      </p>
      <h1>Conexões › Receita Federal</h1>
      <p>
        Com a Receita conectada, o sistema gera sozinho o DAS do MEI, o DAS do Simples (quando a
        declaração do mês aparece) e a guia da DCTFWeb, envia ao cliente e dá baixa quando ele paga.
        Cada empresa precisa ter procuração eletrônica no e-CAC para o CNPJ do escritório.
      </p>
      {c ? (
        <div className="card">
          <p>
            Situação: <strong>{STATUS[c.status]}</strong>
            {c.statusReason && ` (${c.statusReason})`}
          </p>
          {c.paused && (
            <p role="alert" className="alert">
              A Receita não estava respondendo: as consultas estão pausadas e voltam sozinhas em
              alguns minutos.
            </p>
          )}
          <p>Modo: {MODE[c.mode]}</p>
          <p>CNPJ do escritório: {c.officeCnpj}</p>
          {c.termValidUntil && (
            <p>Termo de autorização válido até {formatDateTime(c.termValidUntil)}</p>
          )}
          {c.lastCheckedAt && (
            <p className="muted">Conferida em {formatDateTime(c.lastCheckedAt)}</p>
          )}
          <p>
            Consumo deste mês: {view!.usage.calls} chamadas · {formatCents(view!.usage.costCents)}
          </p>
          <ActionForm action={testFiscalAction} submitLabel="Testar conexão" variant="secondary" />
          <ActionForm action={disconnectFiscalAction} submitLabel="Desconectar" variant="danger" />
        </div>
      ) : (
        <p role="status">
          A Receita ainda não foi conectada. Até lá, as guias são enviadas manualmente em Guias.
        </p>
      )}

      <details className="card" open={!c || c.status !== 'ativa'}>
        <summary>Conectar pelo contrato da plataforma (recomendado)</summary>
        <ol>
          <li>Abra o termo de autorização no Assinador do Serpro, no computador do escritório.</li>
          <li>Assine com o e-CNPJ do escritório. O certificado não sai do seu computador.</li>
          <li>Envie aqui o arquivo XML assinado.</li>
        </ol>
        <ActionForm action={connectPlatformAction} submitLabel="Enviar termo">
          <label htmlFor="pf-cnpj">CNPJ do escritório</label>
          <input id="pf-cnpj" name="officeCnpj" inputMode="numeric" required autoComplete="off" />
          <label htmlFor="pf-xml">Termo de autorização assinado (XML)</label>
          <input
            id="pf-xml"
            name="termXml"
            type="file"
            accept=".xml,text/xml,application/xml"
            required
          />
          <label htmlFor="pf-until">Termo válido até</label>
          <input id="pf-until" name="termValidUntil" type="date" required />
        </ActionForm>
      </details>

      <details className="card">
        <summary>Conectar pelo contrato do próprio escritório</summary>
        <p className="muted">
          Para escritórios que já têm contrato com o Serpro. O e-CNPJ e as chaves ficam cifrados e
          não aparecem de novo.
        </p>
        <ActionForm action={connectOwnAction} submitLabel="Conectar">
          <label htmlFor="pr-cnpj">CNPJ do escritório</label>
          <input id="pr-cnpj" name="officeCnpj" inputMode="numeric" required autoComplete="off" />
          <label htmlFor="pr-key">Consumer key</label>
          <input id="pr-key" name="consumerKey" required autoComplete="off" />
          <label htmlFor="pr-secret">Consumer secret</label>
          <input id="pr-secret" name="consumerSecret" type="password" required autoComplete="off" />
          <label htmlFor="pr-cert">e-CNPJ do escritório (.pfx ou .p12)</label>
          <input id="pr-cert" name="certificate" type="file" accept=".pfx,.p12" required />
          <label htmlFor="pr-pass">Senha do certificado</label>
          <input
            id="pr-pass"
            name="certificatePassword"
            type="password"
            required
            autoComplete="off"
          />
        </ActionForm>
      </details>
    </main>
  );
}
