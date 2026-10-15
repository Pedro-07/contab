/**
 * Instâncias únicas do servidor (auth, fila). Guardadas no globalThis porque o Next pode
 * carregar o módulo mais de uma vez em desenvolvimento.
 */
import { createCipher } from '@contab/adapters/crypto';
import { createEmailSender } from '@contab/adapters/email';
import { createWhatsAppProvider, mirrorToEmail } from '@contab/adapters/whatsapp';
import { portalOriginFrom, type DeliveryDeps } from '@contab/core';
import { createFileStorage, type FileStorage } from '@contab/adapters/storage';
import { createAuth, type Auth } from '@contab/auth';
import { serverEnv } from '@contab/config/env';
import { getDb } from '@contab/db/global';
import { createBoss } from '@contab/db/queue';
import { nextCookies } from 'better-auth/next-js';
import type { PgBoss } from 'pg-boss';

type Services = { auth?: Auth; boss?: Promise<PgBoss>; storage?: FileStorage };
const store = globalThis as typeof globalThis & { __contab?: Services };
const services: Services = (store.__contab ??= {});

export function getAuth(): Auth {
  if (!services.auth) {
    const env = serverEnv();
    services.auth = createAuth({
      db: getDb(),
      email: createEmailSender(env),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      // Grava os cookies de sessão nas server actions.
      frameworkPlugins: [nextCookies()],
      rateLimitScale: env.APP_ENV === 'test' ? 20 : 1,
    });
  }
  return services.auth;
}

/** A web só enfileira; quem executa é o worker. */
export function getBoss(): Promise<PgBoss> {
  if (!services.boss) {
    const boss = createBoss(serverEnv().DATABASE_URL);
    services.boss = boss.start().then(() => boss);
  }
  return services.boss;
}

/** Storage dos documentos (R2 em produção; SeaweedFS em dev e testes). */
export function getStorage(): FileStorage {
  services.storage ??= createFileStorage(serverEnv());
  return services.storage;
}

/** Dependências dos casos de uso de conexão, guias e entrega (incremento 3). */
export async function getDeliveryDeps(): Promise<DeliveryDeps> {
  const env = serverEnv();
  const email = createEmailSender(env);
  return {
    boss: await getBoss(),
    storage: getStorage(),
    whatsapp: createWhatsAppProvider(env, { mirror: mirrorToEmail((m) => email.send(m)) }),
    email,
    cipher: createCipher(env),
    portalOrigin: portalOriginFrom(env.BETTER_AUTH_URL, env.APP_BASE_DOMAIN),
    linkSecret: env.BETTER_AUTH_SECRET,
  };
}
