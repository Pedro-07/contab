'use server';

import {
  addContactToCompany,
  applyCsvImport,
  ClientInputError,
  confirmDocumentUpload,
  createCompany,
  deleteDocument,
  editCompany,
  previewCsvImport,
  removeContactFromCompany,
  requestDocumentUpload,
  setCompanyStatus,
  setContactConsent,
  setDocumentVisibility,
  setPortalAccess,
  type CompanyFormInput,
  type CsvImportResult,
  type CsvPreview,
  type UploadRequest,
} from '@contab/core';
import { ForbiddenError } from '@contab/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formBool, formString, runPainelAction, type ActionResult } from '@/server/actions';
import { requirePainel } from '@/server/painel';
import { getBoss, getStorage } from '@/server/services';

// Os formulários só levam IDs e campos. O tenant vem da sessão (runPainelAction).

function companyInput(formData: FormData): CompanyFormInput {
  return {
    cnpj: formString(formData, 'cnpj'),
    legalName: formString(formData, 'legalName'),
    tradeName: formString(formData, 'tradeName'),
    regime: formString(formData, 'regime') as CompanyFormInput['regime'],
    stateRegistration: formString(formData, 'stateRegistration'),
    municipalRegistration: formString(formData, 'municipalRegistration'),
    poaStatus: (formString(formData, 'poaStatus') || undefined) as CompanyFormInput['poaStatus'],
    poaValidUntil: formString(formData, 'poaValidUntil'),
    notes: formString(formData, 'notes'),
  };
}

export async function createCompanyAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let id = '';
  const result = await runPainelAction('/clientes', async (ctx) => {
    id = (await createCompany(ctx, companyInput(formData))).id;
    return 'Empresa cadastrada.';
  });
  if (result?.ok) redirect(`/clientes/${id}`);
  return result;
}

export async function editCompanyAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await editCompany(ctx, companyId, companyInput(formData));
    return 'Dados salvos.';
  });
}

export async function setCompanyStatusAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await setCompanyStatus(ctx, companyId, formString(formData, 'status'));
    return 'Situação alterada.';
  });
}

export async function addContactAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await addContactToCompany(ctx, companyId, {
      name: formString(formData, 'name'),
      phone: formString(formData, 'phone'),
      email: formString(formData, 'email'),
      role: formString(formData, 'role') as 'socio',
      preferredChannel: formString(formData, 'preferredChannel') as 'whatsapp',
      receivesDeliveries: formBool(formData, 'receivesDeliveries'),
      portalAccess: formBool(formData, 'portalAccess'),
      whatsappOptIn: formBool(formData, 'whatsappOptIn'),
      emailOptIn: formBool(formData, 'emailOptIn'),
    });
    return 'Contato adicionado.';
  });
}

export async function removeContactAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await removeContactFromCompany(ctx, companyId, formString(formData, 'contactId'));
    return 'Contato desvinculado.';
  });
}

export async function portalAccessAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  const grant = formString(formData, 'grant') === 'sim';
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await setPortalAccess(ctx, companyId, formString(formData, 'contactId'), grant);
    return grant ? 'Acesso ao portal liberado.' : 'Acesso ao portal retirado.';
  });
}

export async function consentAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const back = formString(formData, 'back');
  const optIn = formString(formData, 'optIn') === 'sim';
  return runPainelAction(back.startsWith('/clientes/') ? back : '/clientes', async (ctx) => {
    await setContactConsent(
      ctx,
      formString(formData, 'contactId'),
      formString(formData, 'channel'),
      optIn,
    );
    return optIn ? 'Autorização registrada.' : 'Retirada da autorização registrada.';
  });
}

export async function visibilityAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  const visible = formString(formData, 'visible') === 'sim';
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await setDocumentVisibility(ctx, formString(formData, 'documentId'), visible);
    return visible ? 'Documento visível para o cliente.' : 'Documento só para o escritório.';
  });
}

export async function deleteDocumentAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const companyId = formString(formData, 'companyId');
  return runPainelAction(`/clientes/${companyId}`, async (ctx) => {
    await deleteDocument(ctx, formString(formData, 'documentId'));
    return 'Documento excluído.';
  });
}

// ---------------------------------------------------------------------------
// Envio de documento (o arquivo vai do navegador direto para o storage)
// ---------------------------------------------------------------------------

export type StartUploadResult =
  | { ok: true; versionId: string; url: string; headers: Record<string, string> }
  | { ok: false; error: string };

export async function startUploadAction(input: UploadRequest): Promise<StartUploadResult> {
  const { ctx } = await requirePainel();
  try {
    const { versionId, upload } = await requestDocumentUpload(ctx, getStorage(), input);
    return { ok: true, versionId, url: upload.url, headers: upload.headers };
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

export async function confirmUploadAction(companyId: string, versionId: string): Promise<void> {
  const { ctx } = await requirePainel();
  await confirmDocumentUpload(ctx, await getBoss(), versionId);
  revalidatePath(`/clientes/${companyId}`);
}

// ---------------------------------------------------------------------------
// Importação por CSV
// ---------------------------------------------------------------------------

export type ImportState =
  | { step: 'inicio' }
  | { step: 'previa'; preview: CsvPreview }
  | { step: 'feito'; result: CsvImportResult }
  | { step: 'erro'; error: string };

async function fileBytes(formData: FormData): Promise<Uint8Array> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) throw new ClientInputError('Escolha o arquivo.');
  return new Uint8Array(await file.arrayBuffer());
}

export async function importAction(_: ImportState, formData: FormData): Promise<ImportState> {
  const { ctx } = await requirePainel();
  try {
    const bytes = await fileBytes(formData);
    if (formString(formData, 'step') === 'confirmar') {
      const result = await applyCsvImport(ctx, bytes, {
        consentDeclared: formBool(formData, 'consentDeclared'),
      });
      revalidatePath('/clientes');
      return { step: 'feito', result };
    }
    return { step: 'previa', preview: await previewCsvImport(ctx, bytes) };
  } catch (error) {
    if (error instanceof ClientInputError || error instanceof ForbiddenError)
      return { step: 'erro', error: error.message };
    throw error;
  }
}
