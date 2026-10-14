/**
 * Teste de tipo (item 10): repositório de tenant sem TenantTx não compila.
 * Roda no `pnpm typecheck`: se algum @ts-expect-error deixar de ser erro, o typecheck falha.
 */
import {
  listMembers,
  listMyOrganizations,
  withTenant,
  type TenantContext,
  type UserTx,
} from '@contab/db';
import { getDb } from '@contab/db/global';
import type { UserId } from '@contab/domain';

declare const ctx: TenantContext;
declare const userTx: UserTx;
declare const userId: UserId;

export async function exemplos() {
  // Certo: dentro de withTenant.
  await withTenant(ctx, (tx) => listMembers(tx));

  // @ts-expect-error cliente sem contexto de tenant
  await listMembers(getDb());

  // @ts-expect-error transação de usuário não serve para dados do tenant
  await listMembers(userTx);

  // @ts-expect-error contexto sem tenantId
  await withTenant({ actor: ctx.actor, requestId: 'x' }, (tx) => listMembers(tx));

  // Certo: transação de usuário para as próprias organizações.
  await listMyOrganizations(userTx, userId);
}
