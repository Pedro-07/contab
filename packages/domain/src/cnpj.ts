/**
 * CNPJ (seção 9: único por tenant). Aceita o formato numérico e o alfanumérico da Receita
 * (12 caracteres de 0-9 e A-Z, mais 2 dígitos verificadores numéricos). O valor guardado
 * é sem máscara, em maiúsculas.
 */

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Valor de cada caractere no cálculo: código ASCII menos 48 (0-9 valem 0-9, A vale 17). */
function charValue(c: string): number {
  return c.charCodeAt(0) - 48;
}

function checkDigit(base: string, weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + charValue(base[i]!) * w, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Tira máscara e espaços e põe em maiúsculas. Não valida. */
export function normalizeCnpj(input: string): string {
  return input.toUpperCase().replace(/[.\-/\s]/g, '');
}

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!SHAPE.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = checkDigit(cnpj.slice(0, 12), WEIGHTS_1);
  const d2 = checkDigit(cnpj.slice(0, 12) + d1, WEIGHTS_2);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** Normaliza e valida; devolve null se inválido. */
export function parseCnpj(input: string): string | null {
  const cnpj = normalizeCnpj(input);
  return isValidCnpj(cnpj) ? cnpj : null;
}

/** 12.345.678/0001-95 */
export function formatCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
