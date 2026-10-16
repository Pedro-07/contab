/**
 * Integra Contador em produção. Autenticação (documentação "Guia rápido"):
 * POST https://autenticacao.sapi.serpro.gov.br/authenticate, com Basic(consumer key:secret),
 * `role-type: TERCEIROS` e o e-CNPJ do contratante em mTLS. Devolve `access_token` e
 * `jwt_token`, que vão em toda chamada até expirar.
 *
 * O certificado e as chaves chegam por chamada (decifrados pelo núcleo) e ficam só em
 * memória; os tokens ficam num cache em memória por consumer key.
 *
 * Ainda sem contrato: este transporte não foi exercitado contra a produção (pendência do
 * incremento 4). O formato segue a documentação.
 */
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import {
  parseEnvelope,
  postJson,
  requestBody,
  SerproError,
  TIMEOUT_MS,
  type SerproTransport,
} from './envelope';

export const PRODUCTION_AUTH_URL = 'https://autenticacao.sapi.serpro.gov.br/authenticate';
export const PRODUCTION_BASE_URL = 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1';

export type ProductionCredentials = {
  consumerKey: string;
  consumerSecret: string;
  /** e-CNPJ do contratante (PKCS#12) e a senha. */
  certificate: { pfx: Uint8Array; passphrase: string };
};

type Tokens = { accessToken: string; jwtToken: string; expiresAt: number };

const tokenCache = new Map<string, Tokens>();

const authSchema = z.object({
  access_token: z.string().min(1),
  jwt_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
});

function cacheKey(c: ProductionCredentials): string {
  return createHash('sha256').update(c.consumerKey).digest('hex');
}

/** POST com certificado de cliente (mTLS). */
function postWithCertificate(
  url: string,
  headers: Record<string, string>,
  body: string,
  certificate: ProductionCredentials['certificate'],
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
        pfx: Buffer.from(certificate.pfx),
        passphrase: certificate.passphrase,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function authenticate(c: ProductionCredentials): Promise<Tokens> {
  const key = cacheKey(c);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  let res: { status: number; body: string };
  try {
    res = await postWithCertificate(
      PRODUCTION_AUTH_URL,
      {
        Authorization: `Basic ${Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64')}`,
        'role-type': 'TERCEIROS',
        'content-type': 'application/x-www-form-urlencoded',
      },
      'grant_type=client_credentials',
      c.certificate,
    );
  } catch (error) {
    // Senha errada do certificado ou certificado inválido: não adianta repetir.
    if (error instanceof Error && /mac verify|pkcs12|asn1|bad decrypt/i.test(error.message))
      throw new SerproError('credencial', false, null, 'certificado');
    throw new SerproError('indisponivel', true, null);
  }
  if (res.status === 401 || res.status === 403 || res.status === 400)
    throw new SerproError('credencial', false, res.status, 'autenticacao');
  if (res.status >= 500 || res.status === 429)
    throw new SerproError(res.status === 429 ? 'limite' : 'indisponivel', true, res.status);
  let parsed: z.infer<typeof authSchema>;
  try {
    parsed = authSchema.parse(JSON.parse(res.body));
  } catch {
    throw new SerproError('resposta', false, res.status, 'autenticacao');
  }
  const tokens = {
    accessToken: parsed.access_token,
    jwtToken: parsed.jwt_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  tokenCache.set(key, tokens);
  return tokens;
}

export function createProductionTransport(
  loadCredentials: () => Promise<ProductionCredentials>,
  fetchImpl: typeof fetch = fetch,
): SerproTransport {
  return {
    ambiente: 'producao',
    async send(request) {
      const credentials = await loadCredentials();
      const tokens = await authenticate(credentials);
      const res = await postJson(
        `${PRODUCTION_BASE_URL}/${request.endpoint}`,
        {
          Authorization: `Bearer ${tokens.accessToken}`,
          jwt_token: tokens.jwtToken,
          ...(request.procuradorToken
            ? { autenticar_procurador_token: request.procuradorToken }
            : {}),
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        requestBody(request),
        fetchImpl,
      );
      // Token expirado antes da hora: descarta o cache para a próxima tentativa.
      if (res.status === 401) tokenCache.delete(cacheKey(credentials));
      return parseEnvelope(res.status, res.body);
    },
  };
}
