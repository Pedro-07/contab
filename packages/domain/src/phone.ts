/**
 * Telefone em E.164 (seção 9: `(tenant_id, phone)` único). Número brasileiro digitado
 * sem DDI (DDD + número, 10 ou 11 dígitos) ganha +55.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export function parsePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  let candidate: string;
  if (trimmed.startsWith('+')) candidate = `+${digits}`;
  else if (digits.length === 10 || digits.length === 11) candidate = `+55${digits}`;
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))
    candidate = `+${digits}`;
  else return null;
  if (!E164.test(candidate)) return null;
  // Celular brasileiro: DDD de 11 a 99 e, com 9 dígitos, começa com 9.
  if (candidate.startsWith('+55')) {
    const national = candidate.slice(3);
    if (!/^[1-9][1-9]/.test(national)) return null;
    if (national.length === 11 && national[2] !== '9') return null;
    if (national.length !== 10 && national.length !== 11) return null;
  }
  return candidate;
}

/** +5598912345678 → (98) 91234-5678; outros países ficam em E.164. */
export function formatPhone(phone: string): string {
  if (!phone.startsWith('+55')) return phone;
  const n = phone.slice(3);
  const ddd = n.slice(0, 2);
  const rest = n.slice(2);
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}
