'use server';

import { requestFiscalCheckNow } from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';
import { getBoss } from '@/server/services';

/** "Buscar agora": a consulta sai pelo worker; a ficha mostra o resultado. */
export async function checkNowAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await requestFiscalCheckNow(ctx, await getBoss(), companyId);
    return 'Consulta enviada à Receita. Atualize a página em alguns segundos.';
  });
}
