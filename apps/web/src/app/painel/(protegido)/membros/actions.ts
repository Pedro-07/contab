'use server';

import { changeMemberRole, removeMember } from '@contab/core';
import { formString, runPainelAction, type ActionResult } from '@/server/actions';

// Os formulários só levam o ID do recurso. O tenant vem da sessão (runPainelAction).

export async function changeRoleAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  return runPainelAction('/membros', async (ctx) => {
    await changeMemberRole(ctx, formString(formData, 'membershipId'), formString(formData, 'role'));
    return 'Papel alterado.';
  });
}

export async function removeMemberAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return runPainelAction('/membros', async (ctx) => {
    await removeMember(ctx, formString(formData, 'membershipId'));
    return 'Membro removido.';
  });
}
