/**
 * Recurso não encontrado no tenant do contexto. Com RLS, isso cobre tanto "não existe"
 * quanto "é de outro tenant": a resposta é 404 nos dois casos (CA1).
 */
export class NotFoundError extends Error {
  constructor(
    readonly resourceType: string,
    readonly resourceId: string,
  ) {
    super(`${resourceType} não encontrado`);
    this.name = 'NotFoundError';
  }
}

/** Ação negada pelas regras de papel. O motivo é seguro para mostrar ao usuário. */
export class ForbiddenError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ForbiddenError';
  }
}
