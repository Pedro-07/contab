/**
 * Ajudantes dos testes do incremento 3: dependências com o WhatsApp simulado, e-mails em
 * memória e a execução dos jobs da fila como o worker faria.
 */
import { createCipher } from '@contab/adapters/crypto';
import type { EmailMessage } from '@contab/adapters/email';
import { createFakeProvider, signBody } from '@contab/adapters/whatsapp';
import { connectWhatsApp, receiveWhatsAppWebhook, type DeliveryDeps } from '@contab/core';
import type { TenantContext } from '@contab/db';
import { JOBS, type JobName } from '@contab/db/queue';
import { createJobs } from '@contab/worker/jobs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { testStorage } from './helpers';

export type TestDeps = DeliveryDeps & {
  whatsapp: ReturnType<typeof createFakeProvider>;
  outbox: EmailMessage[];
  painelUrl: string;
};

export function testDeliveryDeps(boss: PgBoss, now?: () => Date): TestDeps {
  const outbox: EmailMessage[] = [];
  return {
    boss,
    storage: testStorage(),
    whatsapp: createFakeProvider(),
    email: { send: async (m) => void outbox.push(m) },
    outbox,
    cipher: createCipher({
      CRYPTO_PROVIDER: 'local',
      CRYPTO_LOCAL_KEY: process.env.CRYPTO_LOCAL_KEY!,
    }),
    portalOrigin: (slug) => `http://${slug}.localhost:3000`,
    linkSecret: process.env.BETTER_AUTH_SECRET!,
    painelUrl: 'http://app.localhost:3000',
    ...(now ? { now } : {}),
  };
}

/**
 * Executa os jobs de tenant que estão na fila, até ela esvaziar (como o worker). Só os
 * jobs do escritório dado, para um teste não processar o trabalho de outro.
 */
export async function drainJobs(deps: TestDeps, tenantId: string, rounds = 10): Promise<number> {
  const jobs = new Map(createJobs(deps).map((j) => [j.name, j]));
  let ran = 0;
  for (let round = 0; round < rounds; round++) {
    let found = 0;
    for (const name of Object.keys(JOBS) as JobName[]) {
      const items = await deps.boss.fetch<{ tenantId?: string }>(name, { batchSize: 50 });
      for (const item of items) {
        if (item.data?.tenantId !== tenantId) {
          // Devolve à fila o que é de outro escritório.
          await deps.boss.fail(name, item.id, { motivo: 'outro_teste' });
          continue;
        }
        found++;
        await jobs.get(name)!.run({ id: item.id, data: item.data });
        await deps.boss.complete(name, item.id);
      }
    }
    ran += found;
    if (found === 0) break;
  }
  return ran;
}

// Gerado a cada execução: valor fictício, sem literal que pareça segredo.
export const TEST_APP_SECRET = randomBytes(16).toString('hex');

/** Conecta o WhatsApp simulado no escritório e aprova os templates. */
export async function connectFakeWhatsApp(
  ctx: TenantContext,
  deps: TestDeps,
  phoneNumberId = String(Math.floor(Math.random() * 1e12)).padStart(12, '1'),
) {
  const result = await connectWhatsApp(ctx, deps, {
    appId: '123456789',
    wabaId: '987654321',
    phoneNumberId,
    accessToken: 'token-de-teste-com-mais-de-vinte',
    appSecret: TEST_APP_SECRET,
  });
  await drainJobs(deps, ctx.tenantId);
  return { ...result, phoneNumberId, webhookKey: result.webhookPath.split('/').pop()! };
}

/** Envia um webhook assinado como a Meta. */
export async function postWebhook(
  deps: TestDeps,
  webhookKey: string,
  body: unknown,
  appSecret = TEST_APP_SECRET,
) {
  const raw = JSON.stringify(body);
  return receiveWhatsAppWebhook(webhookKey, raw, signBody(appSecret, raw), deps, {
    requestId: `teste-${randomUUID()}`,
  });
}

export function statusPayload(
  phoneNumberId: string,
  messageId: string,
  status: string,
  errorCode?: number,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '987654321',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: messageId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...(errorCode ? { errors: [{ code: errorCode }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
