/**
 * Criptografia em envelope (ADR 0006, P17). Cada segredo recebe uma chave de dados própria;
 * a chave de dados é protegida pela chave mestra (AWS KMS em produção, chave local em
 * desenvolvimento, testes e CI). O tenant entra como dado autenticado: um texto cifrado
 * de um tenant não decifra no contexto de outro.
 */
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Cipher {
  encrypt(plaintext: Uint8Array, tenantId: string): Promise<string>;
  decrypt(envelope: string, tenantId: string): Promise<Uint8Array>;
}

export type CryptoConfig = {
  CRYPTO_PROVIDER: 'local' | 'aws-kms';
  CRYPTO_LOCAL_KEY?: string | undefined;
  KMS_KEY_ID?: string | undefined;
  KMS_REGION?: string | undefined;
};

const VERSION = 'v1';

function seal(dataKey: Buffer, plaintext: Uint8Array, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(
  dataKey: Buffer,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
  aad: string,
): Uint8Array {
  const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const unb64 = (s: string | undefined) => {
  if (!s) throw new Error('envelope inválido');
  return Buffer.from(s, 'base64');
};

/** Chave mestra local: só para dados fictícios. A validação de env proíbe em produção. */
export function createLocalCipher(base64Key: string): Cipher {
  const masterKey = Buffer.from(base64Key, 'base64');
  if (masterKey.length !== 32) throw new Error('CRYPTO_LOCAL_KEY precisa ter 32 bytes em base64');
  return {
    async encrypt(plaintext, tenantId) {
      const dataKey = randomBytes(32);
      const wrapped = seal(masterKey, dataKey, tenantId);
      const sealed = seal(dataKey, plaintext, tenantId);
      return [
        VERSION,
        'local',
        b64(Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ciphertext])),
        b64(sealed.iv),
        b64(sealed.tag),
        b64(sealed.ciphertext),
      ].join(':');
    },
    async decrypt(envelope, tenantId) {
      const [version, provider, wrappedKey, iv, tag, ciphertext] = envelope.split(':');
      if (version !== VERSION || provider !== 'local') throw new Error('envelope inválido');
      const w = unb64(wrappedKey);
      const dataKey = Buffer.from(
        open(masterKey, w.subarray(0, 12), w.subarray(12, 28), w.subarray(28), tenantId),
      );
      return open(dataKey, unb64(iv), unb64(tag), unb64(ciphertext), tenantId);
    },
  };
}

/** AWS KMS: a chave mestra nunca sai do KMS; cada uso fica no CloudTrail. */
export function createKmsCipher(
  keyId: string,
  region: string,
  client = new KMSClient({ region }),
): Cipher {
  return {
    async encrypt(plaintext, tenantId) {
      const out = await client.send(
        new GenerateDataKeyCommand({
          KeyId: keyId,
          KeySpec: 'AES_256',
          EncryptionContext: { tenant_id: tenantId },
        }),
      );
      if (!out.Plaintext || !out.CiphertextBlob)
        throw new Error('KMS não devolveu a chave de dados');
      const dataKey = Buffer.from(out.Plaintext);
      try {
        const sealed = seal(dataKey, plaintext, tenantId);
        return [
          VERSION,
          'kms',
          b64(out.CiphertextBlob),
          b64(sealed.iv),
          b64(sealed.tag),
          b64(sealed.ciphertext),
        ].join(':');
      } finally {
        dataKey.fill(0);
      }
    },
    async decrypt(envelope, tenantId) {
      const [version, provider, wrappedKey, iv, tag, ciphertext] = envelope.split(':');
      if (version !== VERSION || provider !== 'kms') throw new Error('envelope inválido');
      const out = await client.send(
        new DecryptCommand({
          CiphertextBlob: unb64(wrappedKey),
          KeyId: keyId,
          EncryptionContext: { tenant_id: tenantId },
        }),
      );
      if (!out.Plaintext) throw new Error('KMS não decifrou a chave de dados');
      const dataKey = Buffer.from(out.Plaintext);
      try {
        return open(dataKey, unb64(iv), unb64(tag), unb64(ciphertext), tenantId);
      } finally {
        dataKey.fill(0);
      }
    },
  };
}

export function createCipher(config: CryptoConfig): Cipher {
  if (config.CRYPTO_PROVIDER === 'aws-kms') {
    if (!config.KMS_KEY_ID || !config.KMS_REGION)
      throw new Error('KMS_KEY_ID e KMS_REGION obrigatórios');
    return createKmsCipher(config.KMS_KEY_ID, config.KMS_REGION);
  }
  if (!config.CRYPTO_LOCAL_KEY) throw new Error('CRYPTO_LOCAL_KEY obrigatória');
  return createLocalCipher(config.CRYPTO_LOCAL_KEY);
}
