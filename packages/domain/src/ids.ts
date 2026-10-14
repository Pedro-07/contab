declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function asTenantId(value: string): TenantId {
  if (!isUuid(value)) throw new Error('tenant_id inválido');
  return value as TenantId;
}

export function asUserId(value: string): UserId {
  if (!isUuid(value)) throw new Error('user_id inválido');
  return value as UserId;
}
