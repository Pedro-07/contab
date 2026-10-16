/**
 * Entrada da Serpro no núcleo, só para o worker (CLAUDE.md: "A Serpro é chamada só pelo
 * worker"). O painel e o portal importam `@contab/core`, que só enfileira jobs.
 */
import type { Cipher } from '@contab/adapters/crypto';
import {
  createFakeTransport,
  createProductionTransport,
  createTrialTransport,
  type SerproTransport,
} from '@contab/adapters/serpro';
import type { SerproPlatform } from './runtime';

/** Segredos da plataforma são cifrados com este contexto (não pertencem a um escritório). */
export const PLATFORM_CRYPTO_CONTEXT = 'plataforma';

export type SerproEnv = {
  SERPRO_PROVIDER: 'fake' | 'trial' | 'producao';
  SERPRO_CONTRATANTE_CNPJ: string;
  SERPRO_CONSUMER_KEY_CIPHERTEXT?: string | undefined;
  SERPRO_CONSUMER_SECRET_CIPHERTEXT?: string | undefined;
  SERPRO_CERT_PFX_CIPHERTEXT?: string | undefined;
  SERPRO_CERT_PASSWORD_CIPHERTEXT?: string | undefined;
};

/** Monta a Serpro da plataforma a partir do ambiente. */
export function createSerproPlatform(env: SerproEnv, cipher: Cipher): SerproPlatform {
  if (env.SERPRO_PROVIDER !== 'producao') {
    const transport: SerproTransport =
      env.SERPRO_PROVIDER === 'trial' ? createTrialTransport() : createFakeTransport();
    return {
      ambiente: env.SERPRO_PROVIDER,
      contratanteCnpj: env.SERPRO_CONTRATANTE_CNPJ,
      platformTransport: transport,
      ownTransport: () => transport,
    };
  }
  const decoder = new TextDecoder();
  const open = async (envelope: string | undefined) => {
    if (!envelope) throw new Error('segredo da Serpro ausente');
    return cipher.decrypt(envelope, PLATFORM_CRYPTO_CONTEXT);
  };
  return {
    ambiente: 'producao',
    contratanteCnpj: env.SERPRO_CONTRATANTE_CNPJ,
    // Decifrado a cada autenticação, só em memória.
    platformTransport: createProductionTransport(async () => ({
      consumerKey: decoder.decode(await open(env.SERPRO_CONSUMER_KEY_CIPHERTEXT)),
      consumerSecret: decoder.decode(await open(env.SERPRO_CONSUMER_SECRET_CIPHERTEXT)),
      certificate: {
        pfx: await open(env.SERPRO_CERT_PFX_CIPHERTEXT),
        passphrase: decoder.decode(await open(env.SERPRO_CERT_PASSWORD_CIPHERTEXT)),
      },
    })),
    ownTransport: (load) => createProductionTransport(load),
  };
}

export {
  runSerproConnect,
  runSerproRecalc,
  runSerproTenant,
  runSerproWatch,
  describeError,
  RECALC_RETRY_SECONDS,
  type RecalcOutcome,
  type TenantRoutineResult,
  type WatchOutcome,
} from './routine';
export type { FiscalDeps, SerproPlatform } from './runtime';
