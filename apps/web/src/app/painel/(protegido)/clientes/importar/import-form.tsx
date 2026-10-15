'use client';

import { startTransition, useActionState, useState } from 'react';
import { importAction, type ImportState } from '../actions';

/**
 * Importação em dois passos: prévia (nada é gravado) e confirmação. O arquivo fica na
 * memória do navegador entre os passos e é enviado de novo na confirmação.
 */
export function ImportForm() {
  const [state, run, pending] = useActionState<ImportState, FormData>(importAction, {
    step: 'inicio',
  });
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);

  function send(step: 'previa' | 'confirmar') {
    if (!file) return;
    const data = new FormData();
    data.set('file', file);
    data.set('step', step);
    if (consent) data.set('consentDeclared', 'on');
    startTransition(() => run(data));
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send('previa');
        }}
      >
        <label htmlFor="file">Arquivo CSV</label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => {
            setFile(e.currentTarget.files?.[0] ?? null);
            setConsent(false);
          }}
        />
        <button type="submit" disabled={pending || !file}>
          {pending ? 'Lendo…' : 'Ver prévia'}
        </button>
      </form>

      {state.step === 'erro' && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}

      {state.step === 'previa' && (
        <div className="card" aria-live="polite">
          <h2>Prévia</h2>
          <ul>
            <li>Empresas novas: {state.preview.companiesNew}</li>
            <li>Empresas que serão atualizadas: {state.preview.companiesUpdated}</li>
            <li>Contatos: {state.preview.contacts}</li>
            <li>Linhas com erro (não entram): {state.preview.errors.length}</li>
          </ul>
          {state.preview.errors.length > 0 && (
            <>
              <h3>Linhas com erro</h3>
              <ul>
                {state.preview.errors.slice(0, 100).map((e) => (
                  <li key={e.line}>
                    Linha {e.line}: {e.message}
                  </li>
                ))}
              </ul>
              {state.preview.errors.length > 100 && (
                <p className="muted">E mais {state.preview.errors.length - 100} linhas.</p>
              )}
            </>
          )}
          {state.preview.validLines > 0 ? (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.currentTarget.checked)}
                />{' '}
                Declaro que o escritório tem a autorização dos contatos marcados com &quot;sim&quot;
                nas colunas aceita_whatsapp e aceita_email.
              </label>
              <p className="muted">
                Sem esta declaração, os contatos entram sem autorização e não recebem lembretes.
              </p>
              <button type="button" disabled={pending} onClick={() => send('confirmar')}>
                {pending ? 'Importando…' : 'Confirmar importação'}
              </button>
            </>
          ) : (
            <p role="alert" className="alert">
              Nenhuma linha válida. Corrija o arquivo e tente de novo.
            </p>
          )}
        </div>
      )}

      {state.step === 'feito' && (
        <div role="status" className="card success">
          <p>
            Importação concluída: {state.result.companiesNew} empresas novas,{' '}
            {state.result.companiesUpdated} atualizadas, {state.result.contacts} contatos e{' '}
            {state.result.optIns} autorizações registradas.
          </p>
          <p>
            <a href="/clientes">Ver clientes</a>
          </p>
        </div>
      )}
    </div>
  );
}
