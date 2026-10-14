import { redirect } from 'next/navigation';
import { getPainelState } from '@/server/painel';
import { MfaSetup, MfaVerify } from './mfa-forms';

export default async function MfaPage() {
  const state = await getPainelState();
  if (state.kind === 'anonimo') redirect('/entrar');
  if (state.kind === 'sem_organizacao') redirect('/organizacoes');
  if (state.kind === 'ok') redirect('/');

  return (
    <main>
      <h1>Verificação em duas etapas</h1>
      {state.needsSetup ? (
        <>
          <p>
            Como {state.organization.role} de {state.organization.name}, você precisa usar um
            aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou
            similar).
          </p>
          <MfaSetup />
        </>
      ) : (
        <>
          <p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
          <MfaVerify />
        </>
      )}
    </main>
  );
}
