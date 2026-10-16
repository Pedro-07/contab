import { getGuideReceiptUrl } from '@contab/core';
import { NotFoundError } from '@contab/db';
import { requirePainel } from '@/server/painel';
import { getStorage } from '@/server/services';

/** Comprovante de pagamento da Receita para a equipe: confere tenant e permissão e redireciona (URL de 5 min). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePainel();
  try {
    const url = await getGuideReceiptUrl(ctx, getStorage(), id);
    return new Response(null, {
      status: 303,
      headers: { location: url, 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response('Não encontrado', { status: 404 });
    throw error;
  }
}
