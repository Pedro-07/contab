/**
 * Sessão, organização ativa e MFA (plano da Fundação, itens 14, 15 e 18).
 * Usa o Better Auth de verdade, pelo handler HTTP, com o e-mail capturado em memória.
 */
import type { EmailMessage, EmailSender } from '@contab/adapters/email';
import {
  createAuth,
  readPainelSession,
  resolvePainel,
  switchOrganization,
  type Auth,
} from '@contab/auth';
import { sessions, users } from '@contab/db/schema';
import type { Db } from '@contab/db/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { appDb, ownerDb, securityEventsFor } from './helpers';
import { totp } from './totp';

const seed = inject('seed');
const BASE = 'http://app.localhost:3000';

let app: Db;
let owner: Db;
let auth: Auth;
const outbox: EmailMessage[] = [];

beforeAll(() => {
  app = appDb();
  owner = ownerDb();
  const email: EmailSender = { send: async (m) => void outbox.push(m) };
  auth = createAuth({ db: app, email, secret: process.env.BETTER_AUTH_SECRET!, baseURL: BASE });
});

afterAll(async () => {
  await app.$client.end();
  await owner.$client.end();
});

/** Navegador mínimo: guarda cookies e manda IP próprio (o limite de tentativas é por IP). */
class Browser {
  cookies = new Map<string, string>();
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers({ origin: BASE, 'x-forwarded-for': this.ip, ...extra });
    if (this.cookies.size)
      h.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    return h;
  }

  async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const response = await auth.handler(
      new Request(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: this.headers(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'manual',
      }),
    );
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (raw.toLowerCase().includes('max-age=0') || value === '') this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    return response;
  }

  /** Pede o link mágico, pega no "e-mail" e abre. */
  async loginByMagicLink(email: string): Promise<void> {
    const before = outbox.length;
    const res = await this.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: { email, callbackURL: '/' },
    });
    expect(res.status).toBe(200);
    const message = outbox.slice(before).find((m) => m.to === email);
    expect(message, 'link mágico enviado').toBeDefined();
    const url = new URL(message!.text.match(/https?:\/\/\S+/)![0]);
    const verify = await this.request(`${url.pathname}${url.search}`);
    expect([200, 302]).toContain(verify.status);
  }
}

async function painelState(browser: Browser) {
  const session = await readPainelSession(auth, browser.headers());
  return resolvePainel(session, { requestId: `teste-${randomUUID()}`, ip: browser.ip });
}

describe('link mágico', () => {
  it('não cria usuário para e-mail desconhecido (disableSignUp)', async () => {
    const browser = new Browser();
    const email = `desconhecido-${randomUUID().slice(0, 6)}@exemplo.test`;
    const before = outbox.length;
    await browser.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: { email, callbackURL: '/' },
    });
    const link = outbox.slice(before).find((m) => m.to === email);
    if (link) {
      const url = new URL(link.text.match(/https?:\/\/\S+/)![0]);
      await browser.request(`${url.pathname}${url.search}`);
    }
    expect(await owner.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    expect(browser.cookies.size === 0 || (await painelState(browser)).kind === 'anonimo').toBe(
      true,
    );
  });

  it('o token do link fica com hash no banco', async () => {
    const browser = new Browser();
    const before = outbox.length;
    await browser.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: { email: seed.users.contadorAlfa.email, callbackURL: '/' },
    });
    const token = new URL(
      outbox.slice(before)[0]!.text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get('token')!;
    const { rows } = await owner.$client.query(
      'select identifier from verifications where identifier like $1',
      [`%${token}%`],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('MFA do dono e do admin (18)', () => {
  it('dono sem segundo fator fica em mfa_pendente e não recebe contexto', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.adminAlfa.email);
    const state = await painelState(browser);
    expect(state.kind).toBe('mfa_pendente');
    expect('ctx' in state).toBe(false);
  });

  it('configura TOTP, marca a sessão e libera o painel; código de recuperação vale uma vez', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.donoAlfa.email);

    const enable = await browser.request('/api/auth/two-factor/enable', {
      method: 'POST',
      body: {},
    });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = new URL(totpURI).searchParams.get('secret')!;

    // Código errado não marca a sessão.
    const wrong = await browser.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: '000000' },
    });
    expect(wrong.status).not.toBe(200);
    expect((await painelState(browser)).kind).toBe('mfa_pendente');

    const ok = await browser.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: totp(secret) },
    });
    expect(ok.status).toBe(200);
    const state = await painelState(browser);
    expect(state.kind).toBe('ok');
    if (state.kind === 'ok') expect(state.ctx.tenantId).toBe(seed.alfa.id);

    // Novo login: exige o segundo fator de novo; o código de recuperação funciona só uma vez.
    const second = new Browser();
    await second.loginByMagicLink(seed.users.donoAlfa.email);
    expect((await painelState(second)).kind).toBe('mfa_pendente');
    const code = backupCodes[0]!;
    const first = await second.request('/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      body: { code },
    });
    expect(first.status).toBe(200);
    expect((await painelState(second)).kind).toBe('ok');

    const third = new Browser();
    await third.loginByMagicLink(seed.users.donoAlfa.email);
    const reused = await third.request('/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      body: { code },
    });
    expect(reused.status).not.toBe(200);
    expect((await painelState(third)).kind).toBe('mfa_pendente');
  });

  it('o segredo TOTP fica cifrado no banco', async () => {
    const { rows } = await owner.$client.query<{ secret: string }>(
      'select secret from two_factors where user_id = $1',
      [seed.users.donoAlfa.id],
    );
    expect(rows[0]?.secret).toBeDefined();
    expect(rows[0]!.secret).not.toMatch(/^[A-Z2-7]{16,}$/);
  });

  it('atendente entra sem segundo fator', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.atendenteAlfa.email);
    expect((await painelState(browser)).kind).toBe('ok');
  });

  it('sair revoga a sessão no banco', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.contadorAlfa.email);
    const session = await readPainelSession(auth, browser.headers());
    await browser.request('/api/auth/sign-out', { method: 'POST', body: {} });
    expect(
      await owner.select().from(sessions).where(eq(sessions.id, session!.sessionId)),
    ).toHaveLength(0);
  });
});

describe('organização ativa (14, 15)', () => {
  it('quem está em dois escritórios escolhe; não há escolha automática', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.duplo.email);
    const state = await painelState(browser);
    expect(state.kind).toBe('sem_organizacao');
    if (state.kind === 'sem_organizacao')
      expect(state.organizations.map((o) => o.slug).sort()).toEqual(['alfa', 'beta']);
  });

  it('troca de Alfa para Beta muda o contexto inteiro', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.duplo.email);
    const session = (await readPainelSession(auth, browser.headers()))!;
    const meta = { requestId: `teste-${randomUUID()}`, ip: null };

    expect(await switchOrganization(session, seed.alfa.id, meta)).toBe(true);
    const alfa = await painelState(browser);
    expect(alfa.kind === 'ok' && alfa.ctx.tenantId).toBe(seed.alfa.id);
    expect(alfa.kind === 'ok' && alfa.organization.role).toBe('atendente');

    expect(await switchOrganization(session, seed.beta.id, meta)).toBe(true);
    const beta = await painelState(browser);
    expect(beta.kind === 'ok' && beta.ctx.tenantId).toBe(seed.beta.id);
    expect(beta.kind === 'ok' && beta.organization.role).toBe('contador');
  });

  it('troca para escritório sem membership é negada, sessão intacta, evento registrado', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.atendenteAlfa.email);
    const session = (await readPainelSession(auth, browser.headers()))!;
    const before = await painelState(browser);
    const meta = { requestId: `teste-${randomUUID()}`, ip: null };

    expect(await switchOrganization(session, seed.beta.id, meta)).toBe(false);
    expect(
      await switchOrganization(session, 'nao-e-uuid', {
        ...meta,
        requestId: `${meta.requestId}-b`,
      }),
    ).toBe(false);

    const after = await painelState(browser);
    expect(after.kind === 'ok' && after.ctx.tenantId).toBe(
      before.kind === 'ok' && before.ctx.tenantId,
    );
    expect((await securityEventsFor(owner, meta.requestId))[0]?.type).toBe('tenant_switch_denied');
  });

  it('membership removida tira a organização da sessão', async () => {
    const browser = new Browser();
    await browser.loginByMagicLink(seed.users.duplo.email);
    const session = (await readPainelSession(auth, browser.headers()))!;
    await switchOrganization(session, seed.beta.id, { requestId: 'x', ip: null });
    await owner.$client.query(
      'update memberships set deleted_at = now() where tenant_id = $1 and user_id = $2',
      [seed.beta.id, seed.users.duplo.id],
    );
    try {
      const state = await painelState(browser);
      // Sobra só Alfa: a organização é escolhida sozinha.
      expect(state.kind === 'ok' && state.ctx.tenantId).toBe(seed.alfa.id);
    } finally {
      await owner.$client.query(
        'update memberships set deleted_at = null where tenant_id = $1 and user_id = $2',
        [seed.beta.id, seed.users.duplo.id],
      );
    }
  });
});
