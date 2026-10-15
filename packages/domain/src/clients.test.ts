import { describe, expect, it } from 'vitest';
import { formatCnpj, isValidCnpj, parseCnpj } from './cnpj';
import { checkDeclaredFile, detectFileType, MAX_DOCUMENT_BYTES, safeFileName } from './files';
import { formatPhone, parsePhone } from './phone';
import { canEditClients, canManageDocuments, canViewClients } from './roles';

describe('CNPJ', () => {
  it('aceita com e sem máscara e guarda sem máscara', () => {
    expect(parseCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(parseCnpj(' 11222333000181 ')).toBe('11222333000181');
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('recusa dígito verificador errado, tamanho errado e repetidos', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('abc')).toBe(false);
  });

  it('aceita o CNPJ alfanumérico da Receita', () => {
    expect(parseCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
  });
});

describe('telefone', () => {
  it('normaliza número brasileiro para E.164', () => {
    expect(parsePhone('(98) 91234-5678')).toBe('+5598912345678');
    expect(parsePhone('98 3232-1234')).toBe('+559832321234');
    expect(parsePhone('+55 98 91234-5678')).toBe('+5598912345678');
    expect(parsePhone('5598912345678')).toBe('+5598912345678');
    expect(formatPhone('+5598912345678')).toBe('(98) 91234-5678');
  });

  it('recusa número curto, DDD inválido e celular sem o 9', () => {
    expect(parsePhone('91234-5678')).toBeNull();
    expect(parsePhone('(01) 91234-5678')).toBeNull();
    expect(parsePhone('(98) 81234-5678')).toBeNull();
    expect(parsePhone('')).toBeNull();
  });
});

describe('arquivos (D4)', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it('reconhece PDF, JPG e PNG pelo conteúdo', () => {
    expect(detectFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe('pdf');
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(detectFileType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip/docx
  });

  it('confere tipo e tamanho declarados', () => {
    expect(checkDeclaredFile({ contentType: 'application/pdf', size: 1000 })).toEqual({
      ok: true,
      type: 'pdf',
    });
    expect(checkDeclaredFile({ contentType: 'application/msword', size: 10 }).ok).toBe(false);
    expect(checkDeclaredFile({ contentType: 'image/png', size: MAX_DOCUMENT_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'muito_grande',
    });
    expect(checkDeclaredFile({ contentType: 'image/png', size: 0 })).toEqual({
      ok: false,
      reason: 'vazio',
    });
  });

  it('limpa o nome do arquivo', () => {
    expect(safeFileName('C:\\pasta\\contrato "final".pdf')).toBe('contrato final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('')).toBe('documento');
  });
});

describe('permissões de clientes (D3)', () => {
  it('atendente só vê; dono, admin e contador editam', () => {
    expect(canViewClients('atendente')).toBe(true);
    expect(canEditClients('atendente')).toBe(false);
    expect(canManageDocuments('atendente')).toBe(false);
    for (const role of ['dono', 'admin', 'contador'] as const) {
      expect(canEditClients(role)).toBe(true);
      expect(canManageDocuments(role)).toBe(true);
    }
  });
});
