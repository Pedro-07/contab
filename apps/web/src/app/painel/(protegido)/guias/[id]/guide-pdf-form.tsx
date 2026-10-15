'use client';

import { MAX_DOCUMENT_BYTES } from '@contab/domain';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { confirmGuidePdfAction, startGuidePdfAction } from '../actions';

/** Envio do PDF da guia direto ao storage (URL assinada), com conferência no servidor. */
export function GuidePdfForm({ guideId, hasPdf }: { guideId: string; hasPdf: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('file');
    setError(null);
    if (!(file instanceof File) || file.size === 0) return setError('Escolha o PDF.');
    if (file.size > MAX_DOCUMENT_BYTES) return setError('O PDF passa de 10 MB.');
    setPending(true);
    try {
      const started = await startGuidePdfAction(guideId, {
        size: file.size,
        contentType: file.type || 'application/pdf',
      });
      if (!started.ok) return setError(started.error);
      const put = await fetch(started.url, { method: 'PUT', body: file, headers: started.headers });
      if (!put.ok) return setError('Não foi possível enviar o arquivo. Tente de novo.');
      const problem = await confirmGuidePdfAction(guideId);
      if (problem) return setError(problem);
      router.refresh();
    } catch {
      setError('Não foi possível enviar o arquivo. Confira a conexão e tente de novo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Enviar PDF da guia">
      <label htmlFor="guide-pdf">{hasPdf ? 'Trocar o PDF da guia' : 'PDF da guia'}</label>
      <input id="guide-pdf" name="file" type="file" accept="application/pdf,.pdf" required />
      <button type="submit" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar PDF'}
      </button>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}
