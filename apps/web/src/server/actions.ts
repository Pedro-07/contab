import { InvalidInvitationError, InvitationInputError } from '@contab/core';
import { ForbiddenError, NotFoundError, type TenantContext } from '@contab/db';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requirePainel } from './painel';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string } | null;

/**
 * Envelope das server actions do painel. O tenant vem só da sessão (requirePainel);
 * nenhum campo do formulário define tenant. Recurso de outro tenant vira 404 (CA1).
 */
export async function runPainelAction(
  path: string,
  fn: (ctx: TenantContext) => Promise<string>,
): Promise<ActionResult> {
  const state = await requirePainel();
  try {
    const message = await fn(state.ctx);
    revalidatePath(path);
    return { ok: true, message };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (
      error instanceof ForbiddenError ||
      error instanceof InvitationInputError ||
      error instanceof InvalidInvitationError
    ) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}
