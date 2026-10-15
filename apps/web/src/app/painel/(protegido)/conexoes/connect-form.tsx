'use client';

import { useActionState } from 'react';
import { connectAction, type ConnectState } from './actions';

/** Formulário da conexão manual. A URL e o token aparecem uma vez, depois de salvar. */
export function ConnectForm({ reconnect }: { reconnect: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectAction, null);
  return (
    <>
      <form action={action}>
        <label htmlFor="appId">ID do app (Meta for Developers)</label>
        <input id="appId" name="appId" inputMode="numeric" required autoComplete="off" />
        <label htmlFor="wabaId">WABA ID (conta do WhatsApp Business)</label>
        <input id="wabaId" name="wabaId" inputMode="numeric" required autoComplete="off" />
        <label htmlFor="phoneNumberId">Phone Number ID</label>
        <input
          id="phoneNumberId"
          name="phoneNumberId"
          inputMode="numeric"
          required
          autoComplete="off"
        />
        <label htmlFor="accessToken">Token permanente do usuário do sistema</label>
        <input id="accessToken" name="accessToken" type="password" required autoComplete="off" />
        <label htmlFor="appSecret">App secret</label>
        <input id="appSecret" name="appSecret" type="password" required autoComplete="off" />
        <p className="muted">
          O token e o app secret ficam cifrados e não aparecem de novo. Para trocar, conecte de
          novo.
        </p>
        <button type="submit" disabled={pending}>
          {pending ? 'Conectando…' : reconnect ? 'Reconectar' : 'Conectar'}
        </button>
      </form>
      {state?.ok === false && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      {state?.ok === true && (
        <div role="status" className="card">
          <p className={state.status === 'ativo' ? 'success' : 'alert'}>
            {state.status === 'ativo'
              ? 'WhatsApp conectado. Os modelos de mensagem foram enviados para aprovação da Meta.'
              : `A conexão foi salva, mas a Meta recusou: ${state.reason}`}
          </p>
          <p>
            No app da Meta, em WhatsApp › Configuração › Webhook, cole os dados abaixo e assine os
            campos <span className="code">messages</span> e{' '}
            <span className="code">message_template_status_update</span>. Eles só aparecem agora.
          </p>
          <p>
            URL de retorno: <span className="code">{state.webhookUrl}</span>
          </p>
          <p>
            Token de verificação: <span className="code">{state.verifyToken}</span>
          </p>
        </div>
      )}
    </>
  );
}
