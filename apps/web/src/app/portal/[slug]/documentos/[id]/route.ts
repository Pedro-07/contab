import { getPortalDocumentDownloadUrl } from '@contab/core';
import { NotFoundError } from '@contab/db';
import { getPortalState } from '@/server/portal';
import { getStorage } from '@/server/services';

/** Download no portal: só documento visível da empresa ativa (CA6), por URL de 5 min. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await getPortalState();
  if (!state) return new Response('Não encontrado', { status: 404 });
  try {
    const url = await getPortalDocumentDownloadUrl(state, getStorage(), id);
    return new Response(null, {
      status: 303,
      headers: { location: url, 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response('Não encontrado', { status: 404 });
    throw error;
  }
}
