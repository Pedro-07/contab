import { receiveWhatsAppWebhook, verifyWhatsAppSubscription } from '@contab/core';
import { getRequestMeta } from '@/server/painel';
import { getDeliveryDeps } from '@/server/services';

/**
 * Webhook do WhatsApp na conexão manual (I2): a chave secreta da URL identifica o
 * escritório. A assinatura é conferida com o app secret daquela conexão; o evento é
 * gravado uma vez e processado na fila (CLAUDE.md, "Webhooks").
 */
const MAX_BODY = 1024 * 1024;

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(request.url);
  const challenge = await verifyWhatsAppSubscription(
    key,
    {
      mode: url.searchParams.get('hub.mode'),
      token: url.searchParams.get('hub.verify_token'),
      challenge: url.searchParams.get('hub.challenge'),
    },
    await getRequestMeta(),
  );
  return challenge
    ? new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
    : new Response('Proibido', { status: 403 });
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  const result = await receiveWhatsAppWebhook(
    key,
    raw,
    request.headers.get('x-hub-signature-256'),
    await getDeliveryDeps(),
    await getRequestMeta(),
  );
  return new Response(null, { status: result.status });
}
