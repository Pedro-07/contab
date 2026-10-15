'use server';

import { ClientInputError, connectWhatsApp, testWhatsAppConnection } from '@contab/core';
import { serverEnv } from '@contab/config/env';
import { ForbiddenError } from '@contab/db';
import { revalidatePath } from 'next/cache';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';
import { requirePainel } from '@/server/painel';
import { getDeliveryDeps } from '@/server/services';

export type ConnectState =
  | null
  | { ok: false; error: string }
  | { ok: true; webhookUrl: string; verifyToken: string; status: string; reason: string | null };

/** Conecta e devolve a URL do webhook e o verify token, mostrados uma única vez. */
export async function connectAction(_: ConnectState, formData: FormData): Promise<ConnectState> {
  const { ctx } = await requirePainel();
  try {
    const result = await connectWhatsApp(ctx, await getDeliveryDeps(), {
      appId: formString(formData, 'appId'),
      wabaId: formString(formData, 'wabaId'),
      phoneNumberId: formString(formData, 'phoneNumberId'),
      accessToken: formString(formData, 'accessToken'),
      appSecret: formString(formData, 'appSecret'),
    });
    revalidatePath('/conexoes');
    return {
      ok: true,
      webhookUrl: `${serverEnv().BETTER_AUTH_URL.replace(/\/$/, '')}${result.webhookPath}`,
      verifyToken: result.verifyToken,
      status: result.status,
      reason: result.statusReason,
    };
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

export async function testConnectionAction(_: ActionResult, __: FormData): Promise<ActionResult> {
  return runPainelAction('/conexoes', async (ctx) => {
    const result = await testWhatsAppConnection(ctx, await getDeliveryDeps());
    if (result.status === 'erro') throw new ClientInputError(result.reason ?? 'Falha na conexão.');
    return 'Conexão funcionando. Os modelos de mensagem estão sendo conferidos.';
  });
}
