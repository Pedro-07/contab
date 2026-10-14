import { z } from 'zod';

/** Variáveis comuns à web e ao worker. Toda leitura de ambiente passa por aqui. */
const serverEnvSchema = z
  .object({
    // Ambiente da aplicação. Separado do NODE_ENV porque o `next start` força production.
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    APP_BASE_DOMAIN: z.string().min(1),
    AUTH_EMAIL_FROM: z.string().min(3),
    EMAIL_PROVIDER: z.enum(['smtp', 'resend']).default('smtp'),
    SMTP_URL: z.url().optional(),
    RESEND_API_KEY: z.string().optional(),
    CRYPTO_PROVIDER: z.enum(['local', 'aws-kms']).default('local'),
    CRYPTO_LOCAL_KEY: z.string().optional(),
    KMS_KEY_ID: z.string().optional(),
    KMS_REGION: z.string().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'obrigatório com EMAIL_PROVIDER=smtp',
      });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'obrigatório com EMAIL_PROVIDER=resend',
      });
    }
    if (env.CRYPTO_PROVIDER === 'local' && !env.CRYPTO_LOCAL_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRYPTO_LOCAL_KEY'],
        message: 'obrigatório com CRYPTO_PROVIDER=local',
      });
    }
    if (env.CRYPTO_PROVIDER === 'aws-kms' && (!env.KMS_KEY_ID || !env.KMS_REGION)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_KEY_ID'],
        message: 'KMS_KEY_ID e KMS_REGION obrigatórios com aws-kms',
      });
    }
    // Chave local só serve para dados fictícios (P17).
    if (
      (env.APP_ENV === 'production' || env.APP_ENV === 'staging') &&
      env.CRYPTO_PROVIDER === 'local'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRYPTO_PROVIDER'],
        message: 'staging e produção exigem aws-kms',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    // Só os nomes das variáveis, nunca os valores.
    const campos = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Variáveis de ambiente inválidas: ${campos}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
