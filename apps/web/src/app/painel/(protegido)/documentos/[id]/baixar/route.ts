import { getDocumentDownloadUrl } from '@contab/core';
import { NotFoundError } from '@contab/db';
import { requirePainel } from '@/server/painel';
import { getStorage } from '@/server/services';

/**
 * Download pela equipe: confere o tenant e a permissão e só então redireciona para a
 * URL assinada de 5 minutos (CLAUDE.md, regra 7). Documento de outro escritório é 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePainel();
  const versionId = new URL(request.url).searchParams.get('versao') ?? undefined;
  try {
    const url = await getDocumentDownloadUrl(ctx, getStorage(), id, versionId);
    return new Response(null, {
      status: 303,
      headers: { location: url, 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response('Não encontrado', { status: 404 });
    throw error;
  }
}
