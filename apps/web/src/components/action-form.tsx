'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, type ReactNode } from 'react';
import type { ActionResult } from '@/server/actions';

type Action = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Formulário de server action com mensagem de resultado acessível. */
export function ActionForm({
  action,
  children,
  submitLabel,
  variant,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  variant?: 'secondary' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  const redirectTo = state?.ok ? state.redirectTo : undefined;
  useEffect(() => {
    if (redirectTo) router.push(redirectTo);
  }, [redirectTo, router]);
  return (
    <form action={formAction}>
      {children}
      <button type="submit" className={variant} disabled={pending}>
        {pending ? 'Aguarde…' : submitLabel}
      </button>
      {state?.ok === false && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      {state?.ok === true && (
        <p role="status" className="success">
          {state.message}
        </p>
      )}
    </form>
  );
}
