/**
 * Cifra um segredo da plataforma (contrato e e-CNPJ do Pedro) para as variáveis
 * SERPRO_*_CIPHERTEXT do worker. Usa a mesma chave do ambiente (KMS em produção).
 * O segredo é lido de um arquivo e nunca aparece no terminal nem em log.
 * Uso: pnpm serpro:cifrar <arquivo>   (ex.: o .pfx, ou um .txt com a consumer key)
 */
import { createCipher } from '@contab/adapters/crypto';
import { serverEnv } from '@contab/config/env';
import { PLATFORM_CRYPTO_CONTEXT } from '@contab/core/serpro-worker';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: pnpm serpro:cifrar <arquivo>');
  process.exit(1);
}
const raw = readFileSync(file);
// Arquivo de texto (chave, segredo, senha): sem a quebra de linha do fim.
const bytes = /\.(pfx|p12)$/i.test(file) ? raw : Buffer.from(raw.toString('utf8').trim(), 'utf8');
console.log(
  await createCipher(serverEnv()).encrypt(new Uint8Array(bytes), PLATFORM_CRYPTO_CONTEXT),
);
