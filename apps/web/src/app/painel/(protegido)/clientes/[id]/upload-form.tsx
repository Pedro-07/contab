'use client';

import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES } from '@contab/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { CATEGORY_LABEL } from '@/lib/labels';
import { confirmUploadAction, startUploadAction } from '../actions';

const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

/**
 * Envio de documento: pede a URL assinada ao servidor, manda o arquivo direto para o
 * storage e confirma. A verificação do arquivo é feita depois, pelo worker.
 */
export function UploadForm({
  companyId,
  documentId,
  label,
}: {
  companyId: string;
  documentId?: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const id = documentId ? `upload-${documentId}` : 'upload-novo';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    setError(null);
    setDone(false);
    if (!(file instanceof File) || file.size === 0) return setError('Escolha o arquivo.');
    if (file.size > MAX_DOCUMENT_BYTES) return setError('O arquivo passa de 10 MB.');

    setPending(true);
    try {
      const started = await startUploadAction({
        companyId,
        ...(documentId
          ? { documentId }
          : {
              category: String(data.get('category')) as (typeof DOCUMENT_CATEGORIES)[number],
              title: String(data.get('title') ?? ''),
              visibleToClient: data.get('visibleToClient') === 'on',
            }),
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      if (!started.ok) return setError(started.error);
      const put = await fetch(started.url, {
        method: 'PUT',
        body: file,
        headers: started.headers,
      });
      if (!put.ok) return setError('Não foi possível enviar o arquivo. Tente de novo.');
      await confirmUploadAction(companyId, started.versionId);
      form.reset();
      setDone(true);
      router.refresh();
    } catch {
      setError('Não foi possível enviar o arquivo. Confira a conexão e tente de novo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label={label}>
      {!documentId && (
        <>
          <label htmlFor={`${id}-category`}>Pasta</label>
          <select id={`${id}-category`} name="category" required defaultValue="">
            <option value="" disabled>
              Escolha
            </option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-title`}>Nome do documento (opcional)</label>
          <input id={`${id}-title`} name="title" maxLength={200} />
          <label className="check">
            <input type="checkbox" name="visibleToClient" defaultChecked /> Visível para o cliente
            no portal
          </label>
        </>
      )}
      <label htmlFor={`${id}-file`}>{documentId ? 'Arquivo da nova versão' : 'Arquivo'}</label>
      <input id={`${id}-file`} name="file" type="file" accept={ACCEPT} required />
      <p className="muted">PDF, JPG ou PNG, até 10 MB.</p>
      <button type="submit" disabled={pending}>
        {pending ? 'Enviando…' : label}
      </button>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="success">
          Arquivo enviado. Estamos conferindo o arquivo.
        </p>
      )}
    </form>
  );
}

/** Atualiza a página enquanto algum arquivo está em verificação (até 1 minuto). */
export function RefreshWhilePending({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= 30) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
