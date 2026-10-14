import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLocalCipher } from './index';

const key = randomBytes(32).toString('base64');
const alfa = '0190a000-0000-7000-8000-000000000001';
const beta = '0190a000-0000-7000-8000-000000000002';

describe('criptografia em envelope (local)', () => {
  it('cifra e decifra no mesmo tenant', async () => {
    const cipher = createLocalCipher(key);
    const envelope = await cipher.encrypt(Buffer.from('segredo'), alfa);
    expect(envelope).not.toContain('segredo');
    expect(Buffer.from(await cipher.decrypt(envelope, alfa)).toString()).toBe('segredo');
  });

  it('não decifra no contexto de outro tenant', async () => {
    const cipher = createLocalCipher(key);
    const envelope = await cipher.encrypt(Buffer.from('segredo'), alfa);
    await expect(cipher.decrypt(envelope, beta)).rejects.toThrow();
  });

  it('cada cifragem usa chave de dados e IV novos', async () => {
    const cipher = createLocalCipher(key);
    const a = await cipher.encrypt(Buffer.from('x'), alfa);
    const b = await cipher.encrypt(Buffer.from('x'), alfa);
    expect(a).not.toBe(b);
  });

  it('recusa chave mestra com tamanho errado', () => {
    expect(() => createLocalCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});
