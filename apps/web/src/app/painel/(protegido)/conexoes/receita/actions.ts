'use server';

import {
  ClientInputError,
  connectFiscalOwn,
  connectFiscalPlatform,
  disconnectFiscal,
  testFiscalConnection,
} from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';
import { getDeliveryDeps } from '@/server/services';

const PATH = '/conexoes/receita';

function formFile(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/** Modo plataforma: o XML do termo assinado no computador do escritório. */
export async function connectPlatformAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction(PATH, async (ctx) => {
    const file = formFile(formData, 'termXml');
    if (!file) throw new ClientInputError('Envie o termo de autorização assinado (arquivo XML).');
    if (file.size > 256 * 1024) throw new ClientInputError('O arquivo do termo passa de 256 KB.');
    await connectFiscalPlatform(ctx, await getDeliveryDeps(), {
      officeCnpj: formString(formData, 'officeCnpj'),
      termXml: await file.text(),
      termValidUntil: formString(formData, 'termValidUntil'),
    });
    return 'Termo recebido. A conexão está sendo conferida com a Receita.';
  });
}

/** Modo próprio: contrato e e-CNPJ do escritório. */
export async function connectOwnAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  return runPainelAction(PATH, async (ctx) => {
    const file = formFile(formData, 'certificate');
    if (!file) throw new ClientInputError('Envie o e-CNPJ do escritório (arquivo .pfx ou .p12).');
    if (file.size > 64 * 1024) throw new ClientInputError('O certificado passa de 64 KB.');
    await connectFiscalOwn(ctx, await getDeliveryDeps(), {
      officeCnpj: formString(formData, 'officeCnpj'),
      consumerKey: formString(formData, 'consumerKey'),
      consumerSecret: formString(formData, 'consumerSecret'),
      certificate: new Uint8Array(await file.arrayBuffer()),
      certificatePassword: formString(formData, 'certificatePassword'),
    });
    return 'Credenciais recebidas. A conexão está sendo conferida com a Receita.';
  });
}

export async function testFiscalAction(_: ActionResult, __: FormData): Promise<ActionResult> {
  return runPainelAction(PATH, async (ctx) => {
    await testFiscalConnection(ctx, (await getDeliveryDeps()).boss);
    return 'Teste enviado. Atualize a página em alguns segundos para ver o resultado.';
  });
}

export async function disconnectFiscalAction(_: ActionResult, __: FormData): Promise<ActionResult> {
  return runPainelAction(PATH, async (ctx) => {
    await disconnectFiscal(ctx);
    return 'Receita Federal desconectada. As guias deixam de sair sozinhas.';
  });
}
