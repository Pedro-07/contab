/**
 * Configuração do Better Auth (ADR 0007, P13, P14, P18).
 * - Link mágico só para usuários existentes, com token guardado como hash.
 * - Sessões no banco, revogáveis, com a organização ativa e a marca do MFA.
 * - TOTP e códigos de recuperação pelo plugin twoFactor; a trava do painel é nossa.
 */
import type { EmailSender } from '@contab/adapters/email';
import { markSessionMfaVerifiedByToken, recordSecurityEvent, type Db } from '@contab/db/global';
import * as schema from '@contab/db/schema';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

const MFA_PATHS = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

export type AuthDeps = {
  db: Db;
  email: EmailSender;
  secret: string;
  baseURL: string;
  /** Plugins de integração com o framework, sempre por último (a web passa o nextCookies). */
  frameworkPlugins?: BetterAuthPlugin[];
  /** Multiplica os limites de tentativa. Só o ambiente de teste (E2E, um IP só) usa mais de 1. */
  rateLimitScale?: number;
};

export function createAuth({
  db,
  email,
  secret,
  baseURL,
  frameworkPlugins = [],
  rateLimitScale = 1,
}: AuthDeps) {
  const https = baseURL.startsWith('https://');
  const limit = (max: number) => max * rateLimitScale;

  return betterAuth({
    appName: 'Plataforma Contábil',
    baseURL,
    secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
        rateLimit: schema.rateLimits,
      },
    }),
    // Sem senha no painel (P13).
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Sem cache em cookie: a sessão é lida do banco a cada requisição, então revogar vale na hora.
      cookieCache: { enabled: false },
      additionalFields: {
        activeTenantId: { type: 'string', required: false, input: false },
        mfaVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: limit(60),
      customRules: {
        '/sign-in/magic-link': { window: 60, max: limit(3) },
        '/magic-link/verify': { window: 60, max: limit(10) },
        // A verificação numa sessão aberta não conta tentativas no plugin; o limite fica aqui.
        '/two-factor/verify-totp': { window: 300, max: limit(5) },
        '/two-factor/verify-backup-code': { window: 300, max: limit(5) },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      cookiePrefix: 'painel',
      // Em HTTPS, o cookie de sessão usa o prefixo __Host- (P16): preso ao host, sem Domain.
      // O Better Auth sempre prefixa __Secure- quando useSecureCookies está ligado, então
      // o Secure vem dos atributos e o nome é definido aqui.
      useSecureCookies: false,
      defaultCookieAttributes: { secure: https, sameSite: 'lax', path: '/', httpOnly: true },
      ...(https ? { cookies: { session_token: { name: '__Host-painel.session' } } } : {}),
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned as { token?: unknown } | Error | undefined;
        const ok = returned && !(returned instanceof Error) && typeof returned.token === 'string';

        if (MFA_PATHS.has(ctx.path)) {
          if (ok) {
            // Na primeira ativação do TOTP o plugin troca a sessão, mas devolve no corpo o token
            // da antiga, já apagada. Nesse caso a sessão que vale é a nova, posta no cookie.
            const token = ctx.context.newSession?.session.token ?? (returned.token as string);
            await markSessionMfaVerifiedByToken(token, db);
          } else {
            await recordSecurityEvent(
              { type: 'mfa_failed', userId: ctx.context.session?.user.id ?? null },
              db,
            );
          }
        }

        if (ctx.path === '/magic-link/verify' && ctx.context.returned instanceof Error) {
          await recordSecurityEvent(
            { type: 'login_failed', details: { motivo: 'link_magico_invalido' } },
            db,
          );
        }
      }),
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        storeToken: 'hashed',
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        async sendMagicLink({ email: to, url }) {
          await email.send({
            to,
            subject: 'Seu link de acesso',
            text: [
              'Use o link abaixo para entrar no painel. Ele vale por 15 minutos e só funciona uma vez.',
              '',
              url,
              '',
              'Se você não pediu este acesso, ignore este e-mail.',
            ].join('\n'),
          });
        },
      }),
      twoFactor({
        issuer: 'Plataforma Contábil',
        allowPasswordless: true,
        // Os códigos de recuperação ficam cifrados (padrão do plugin).
      }),
      ...frameworkPlugins,
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
