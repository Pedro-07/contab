import { ForbiddenError, NotFoundError, type TenantContext } from '@contab/db';
import { recordSecurityEvent } from '@contab/db/global';
import type { Role } from '@contab/domain';

/** Papel de quem age. Jobs e o operador não passam por regras de papel de membro. */
export function actorRole(ctx: TenantContext): Role | null {
  return ctx.actor.type === 'member' ? ctx.actor.role : null;
}

export function actorUserId(ctx: TenantContext): string | null {
  return ctx.actor.type === 'member' ? ctx.actor.userId : null;
}

/** Nega a ação, registra em security_events e lança ForbiddenError. */
export async function deny(
  ctx: TenantContext,
  reason: string,
  resourceType?: string,
): Promise<never> {
  await recordSecurityEvent({
    type: 'forbidden',
    userId: actorUserId(ctx),
    activeTenantId: ctx.tenantId,
    resourceType: resourceType ?? null,
    ip: ctx.ip ?? null,
    requestId: ctx.requestId,
    details: { motivo: reason },
  });
  throw new ForbiddenError(reason);
}

/**
 * Executa o caso de uso e, se algum recurso não existir no tenant do contexto,
 * registra resource_not_found (CA1) antes de repassar o erro. A rota responde 404.
 */
export async function logNotFound<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotFoundError) {
      await recordSecurityEvent({
        type: 'resource_not_found',
        userId: actorUserId(ctx),
        activeTenantId: ctx.tenantId,
        resourceType: error.resourceType,
        resourceId: error.resourceId,
        ip: ctx.ip ?? null,
        requestId: ctx.requestId,
      });
    }
    throw error;
  }
}
