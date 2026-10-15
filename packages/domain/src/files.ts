/**
 * Arquivos de documentos (D4): PDF, JPG e PNG até 10 MB. O tipo vale pelo conteúdo
 * (assinatura dos primeiros bytes), não pela extensão nem pelo que o navegador declara.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_FILE_TYPES = {
  pdf: { contentType: 'application/pdf', extension: 'pdf' },
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
} as const;

export type DocumentFileType = keyof typeof DOCUMENT_FILE_TYPES;

/** Quantos bytes do início bastam para reconhecer o tipo. */
export const FILE_SIGNATURE_BYTES = 8;

const SIGNATURES: Array<{ type: DocumentFileType; bytes: number[] }> = [
  { type: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export function detectFileType(head: Uint8Array): DocumentFileType | null {
  for (const { type, bytes } of SIGNATURES) {
    if (head.length >= bytes.length && bytes.every((b, i) => head[i] === b)) return type;
  }
  return null;
}

export function fileTypeFromContentType(contentType: string): DocumentFileType | null {
  const normalized = contentType.split(';')[0]!.trim().toLowerCase();
  for (const [type, info] of Object.entries(DOCUMENT_FILE_TYPES)) {
    if (info.contentType === normalized) return type as DocumentFileType;
  }
  return null;
}

export type DeclaredFileCheck =
  | { ok: true; type: DocumentFileType }
  | { ok: false; reason: 'tipo_nao_permitido' | 'muito_grande' | 'vazio' };

/** Primeira checagem, com o que o navegador declarou. A definitiva é a do worker. */
export function checkDeclaredFile(input: { contentType: string; size: number }): DeclaredFileCheck {
  const type = fileTypeFromContentType(input.contentType);
  if (!type) return { ok: false, reason: 'tipo_nao_permitido' };
  if (!Number.isInteger(input.size) || input.size <= 0) return { ok: false, reason: 'vazio' };
  if (input.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'muito_grande' };
  return { ok: true, type };
}

/** Nome de arquivo seguro para mostrar e para o Content-Disposition. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Tira caracteres de controle e os que quebram nome de arquivo ou cabeçalho.
  const cleaned = [...base.normalize('NFC')]
    .filter((c) => c >= ' ' && c !== '\x7f' && !'"<>|:*?'.includes(c))
    .join('')
    .trim()
    .slice(0, 120);
  return cleaned || 'documento';
}
