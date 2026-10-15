import { getWhatsAppStatus } from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { ActionForm } from '@/components/action-form';
import { formatDateTime } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { testConnectionAction } from './actions';
import { ConnectForm } from './connect-form';

const CHANNEL_STATUS = {
  pendente: 'Conferindo',
  ativo: 'Ativo',
  erro: 'Com erro',
  desconectado: 'Desconectado',
} as const;

const TEMPLATE_STATUS = {
  enviado: 'Em análise na Meta',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  pausado: 'Pausado',
  desativado: 'Desativado',
} as const;

const TEMPLATE_NAME: Record<string, string> = {
  guia_disponivel: 'Guia disponível',
  lembrete_vencimento: 'Lembrete de vencimento',
  guia_vencida: 'Guia vencida',
  pagamento_confirmado: 'Pagamento confirmado',
  documento_disponivel: 'Documento disponível',
  codigo_acesso: 'Código de acesso ao portal',
};

export default async function ConexoesPage() {
  const { ctx } = await requirePainel();
  const status = await getWhatsAppStatus(ctx).catch((error) => {
    if (error instanceof ForbiddenError) return 'negado' as const;
    throw error;
  });
  if (status === 'negado') {
    return (
      <main>
        <h1>Conexões</h1>
        <p role="alert">Seu papel não permite ver as conexões.</p>
      </main>
    );
  }
  const channel = status?.channel;
  return (
    <main>
      <h1>Conexões › WhatsApp</h1>
      <p>
        As mensagens saem pelo número do próprio escritório, pela API oficial da Meta. Não use
        aplicativos não oficiais nesse número.
      </p>
      {status && channel ? (
        <div className="card">
          <p>
            <strong>{channel.verifiedName ?? 'Número'}</strong>{' '}
            <span className="muted">{channel.displayPhone}</span>
          </p>
          <p>
            Situação: <strong>{CHANNEL_STATUS[channel.status]}</strong>
            {channel.statusReason && ` (${channel.statusReason})`}
            {channel.qualityRating && ` · qualidade ${channel.qualityRating}`}
          </p>
          {channel.lastCheckedAt && (
            <p className="muted">Conferido em {formatDateTime(channel.lastCheckedAt)}</p>
          )}
          <ActionForm
            action={testConnectionAction}
            submitLabel="Testar conexão"
            variant="secondary"
          />
          <h2>Modelos de mensagem</h2>
          {status.templates.length === 0 && <p role="status">Ainda não enviados à Meta.</p>}
          <ul>
            {status.templates.map((t) => (
              <li key={t.id}>
                {TEMPLATE_NAME[t.key] ?? t.key}: <strong>{TEMPLATE_STATUS[t.status]}</strong>
                {t.reason && <span className="muted"> ({t.reason})</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p role="status">O WhatsApp ainda não foi conectado. Até lá, os envios saem por e-mail.</p>
      )}
      <details className="card" open={!channel}>
        <summary>{channel ? 'Reconectar ou trocar o número' : 'Conectar o WhatsApp'}</summary>
        <ConnectForm reconnect={Boolean(channel)} />
      </details>
    </main>
  );
}
