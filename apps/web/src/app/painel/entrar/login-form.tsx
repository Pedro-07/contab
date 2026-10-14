'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const { error: err } = await authClient.signIn.magicLink({ email, callbackURL: '/' });
    setPending(false);
    // A resposta é a mesma exista ou não a conta, para não revelar quem é usuário.
    if (err && err.status === 429) {
      setError('Muitas tentativas. Aguarde um minuto e tente de novo.');
      return;
    }
    router.push('/entrar/enviado');
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? 'Enviando…' : 'Enviar link de acesso'}
        </button>
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}
