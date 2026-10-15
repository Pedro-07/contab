'use server';

import {
  cancelGuide,
  ClientInputError,
  confirmGuidePdf,
  createGuide,
  markGuidePaid,
  publishGuide,
  requestGuidePdfUpload,
} from '@contab/core';
import { ForbiddenError, NotFoundError } from '@contab/db';
import { revalidatePath } from 'next/cache';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';
import { requirePainel } from '@/server/painel';
import { getBoss, getStorage } from '@/server/services';

// O tenant vem da sessão (runPainelAction); os formulários só levam IDs e campos.

export async function createGuideAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let id = '';
  const result = await runPainelAction('/guias', async (ctx) => {
    id = (
      await createGuide(ctx, {
        companyId: formString(formData, 'companyId'),
        type: formString(formData, 'type') as 'das_simples',
        period: formString(formData, 'period'),
        dueDate: formString(formData, 'dueDate'),
        amount: formString(formData, 'amount'),
        barcode: formString(formData, 'barcode'),
        pixCode: formString(formData, 'pixCode'),
      })
    ).id;
    return 'Guia criada. Agora envie o PDF.';
  });
  return result?.ok ? { ...result, redirectTo: `/guias/${id}` } : result;
}

export type PdfUploadStart =
  { ok: true; url: string; headers: Record<string, string> } | { ok: false; error: string };

export async function startGuidePdfAction(
  guideId: string,
  file: { size: number; contentType: string },
): Promise<PdfUploadStart> {
  const { ctx } = await requirePainel();
  try {
    const upload = await requestGuidePdfUpload(ctx, getStorage(), guideId, file);
    return { ok: true, url: upload.url, headers: upload.headers };
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: 'Guia não encontrada.' };
    throw error;
  }
}

export async function confirmGuidePdfAction(guideId: string): Promise<string | null> {
  const { ctx } = await requirePainel();
  try {
    await confirmGuidePdf(ctx, getStorage(), guideId);
    revalidatePath(`/guias/${guideId}`);
    return null;
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof ForbiddenError) return error.message;
    throw error;
  }
}

export async function publishGuideAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const guideId = formString(formData, 'guideId');
  return runPainelAction(`/guias/${guideId}`, async (ctx) => {
    await publishGuide(ctx, await getBoss(), guideId);
    return 'Guia publicada. O envio para os contatos começou.';
  });
}

export async function markPaidAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const guideId = formString(formData, 'guideId');
  return runPainelAction(`/guias/${guideId}`, async (ctx) => {
    await markGuidePaid(ctx, await getBoss(), guideId, formString(formData, 'reason'));
    return 'Pagamento registrado. O cliente vai receber a confirmação.';
  });
}

export async function cancelGuideAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const guideId = formString(formData, 'guideId');
  return runPainelAction(`/guias/${guideId}`, async (ctx) => {
    await cancelGuide(ctx, guideId, formString(formData, 'reason'));
    return 'Guia cancelada.';
  });
}
