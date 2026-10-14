import { redirect } from 'next/navigation';
import { getPainelState } from '@/server/painel';
import { LoginForm } from './login-form';

export default async function EntrarPage() {
  const state = await getPainelState();
  if (state.kind !== 'anonimo') redirect('/');
  return (
    <main>
      <h1>Entrar no painel</h1>
      <p className="muted">
        Informe seu e-mail. Enviaremos um link de acesso que vale por 15 minutos.
      </p>
      <LoginForm />
    </main>
  );
}
