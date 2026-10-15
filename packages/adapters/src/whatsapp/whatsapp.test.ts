import { TEMPLATE_LIBRARY } from '@contab/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  createCloudApiProvider,
  createFakeProvider,
  mapTemplateStatus,
  signBody,
  verifySignature,
  WhatsAppError,
} from './index';

const conn = { appId: 'app1', wabaId: 'waba1', phoneNumberId: 'phone1', accessToken: 'tok' };

afterEach(() => vi.unstubAllGlobals());

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
  return calls;
}

describe('assinatura do webhook', () => {
  it('confere o HMAC e recusa o resto', () => {
    const body = '{"entry":[]}';
    const header = signBody('segredo', body);
    expect(verifySignature('segredo', body, header)).toBe(true);
    expect(verifySignature('outro', body, header)).toBe(false);
    expect(verifySignature('segredo', `${body} `, header)).toBe(false);
    expect(verifySignature('segredo', body, null)).toBe(false);
    expect(verifySignature('segredo', body, 'sha256=abc')).toBe(false);
  });
});

describe('erros da Cloud API', () => {
  it('template pausado e número inválido são permanentes; limite é temporário', () => {
    expect(classifyError(132015, 400)).toMatchObject({
      permanent: true,
      kind: 'template_indisponivel',
    });
    expect(classifyError(131026, 400)).toMatchObject({ permanent: true, kind: 'destinatario' });
    expect(classifyError(190, 401)).toMatchObject({ permanent: true, kind: 'credencial' });
    expect(classifyError(130429, 429)).toMatchObject({ permanent: false, kind: 'limite' });
    expect(classifyError(null, 503).permanent).toBe(false);
    expect(mapTemplateStatus('APPROVED')).toBe('aprovado');
    expect(mapTemplateStatus('PAUSED')).toBe('pausado');
    expect(mapTemplateStatus('PENDING')).toBe('enviado');
  });
});

describe('Cloud API', () => {
  const provider = createCloudApiProvider({ graphVersion: 'v23.0' });

  it('envia template com PDF, variáveis e botão do link', async () => {
    const calls = mockFetch({ status: 200, body: { messages: [{ id: 'wamid.1' }] } });
    const result = await provider.sendTemplate(conn, {
      to: '+5598990000001',
      templateName: 'guia_disponivel_v1',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyValues: ['Maria', 'Contact'],
      document: { mediaId: 'm1', fileName: 'guia.pdf' },
      linkSuffix: 'TOKEN',
    });
    expect(result.messageId).toBe('wamid.1');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/phone1/messages');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '5598990000001' });
    expect(body.template.components).toEqual([
      {
        type: 'header',
        parameters: [{ type: 'document', document: { id: 'm1', filename: 'guia.pdf' } }],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'Contact' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'TOKEN' }],
      },
    ]);
  });

  it('código de acesso usa o formato de autenticação', async () => {
    const calls = mockFetch({ status: 200, body: { messages: [{ id: 'wamid.2' }] } });
    await provider.sendTemplate(conn, {
      to: '+5598990000001',
      templateName: 'codigo_acesso_v1',
      language: 'pt_BR',
      category: 'AUTHENTICATION',
      bodyValues: ['123456'],
    });
    const components = JSON.parse(calls[0]!.init.body as string).template.components;
    expect(components[1]).toMatchObject({ type: 'button', sub_type: 'url' });
  });

  it('tenta de novo em erro temporário e para no permanente', async () => {
    const temp = mockFetch(
      { status: 429, body: { error: { code: 130429 } } },
      { status: 200, body: { messages: [{ id: 'wamid.3' }] } },
    );
    await expect(
      provider.sendTemplate(conn, {
        to: '+5598990000001',
        templateName: 'x',
        language: 'pt_BR',
        category: 'UTILITY',
        bodyValues: [],
      }),
    ).resolves.toEqual({ messageId: 'wamid.3' });
    expect(temp).toHaveLength(2);

    const perm = mockFetch({ status: 400, body: { error: { code: 132015 } } });
    await expect(
      provider.sendTemplate(conn, {
        to: '+5598990000001',
        templateName: 'x',
        language: 'pt_BR',
        category: 'UTILITY',
        bodyValues: [],
      }),
    ).rejects.toMatchObject({ permanent: true, kind: 'template_indisponivel' });
    expect(perm).toHaveLength(1);
  });

  it('submete template com documento: sobe o PDF de exemplo e monta botão com a base do portal', async () => {
    const calls = mockFetch(
      { status: 200, body: { id: 'upload:1' } },
      { status: 200, body: { h: 'HANDLE' } },
      { status: 200, body: { id: 'tpl1', status: 'PENDING' } },
    );
    const result = await provider.submitTemplate(conn, TEMPLATE_LIBRARY.guia_disponivel, {
      name: 'guia_disponivel_v1',
      linkBaseUrl: 'https://contact.exemplo.com.br/',
    });
    expect(result).toEqual({ templateId: 'tpl1', status: 'PENDING' });
    expect(calls[0]!.url).toContain('app1/uploads?file_length=');
    const body = JSON.parse(calls[2]!.init.body as string);
    expect(calls[2]!.url).toBe('https://graph.facebook.com/v23.0/waba1/message_templates');
    expect(body.components[0]).toEqual({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: { header_handle: ['HANDLE'] },
    });
    expect(body.components[2].buttons[0].url).toBe('https://contact.exemplo.com.br/g/{{1}}');
    expect(body.components[1].example.body_text[0]).toHaveLength(7);
  });
});

describe('fake', () => {
  it('guarda as mensagens e simula número inválido', async () => {
    const fake = createFakeProvider();
    await fake.sendTemplate(conn, {
      to: '+5598990000001',
      templateName: 't',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyValues: [],
    });
    expect(fake.sent).toHaveLength(1);
    await expect(
      fake.sendTemplate(conn, {
        to: '+5598990000000',
        templateName: 't',
        language: 'pt_BR',
        category: 'UTILITY',
        bodyValues: [],
      }),
    ).rejects.toBeInstanceOf(WhatsAppError);
  });
});

describe('remetente do e-mail', () => {
  it('usa o nome do escritório com o endereço da plataforma, sem injeção', async () => {
    const { fromHeader } = await import('../email/index');
    expect(fromHeader('Plataforma <nao-responda@x.test>', 'Contact Consultoria')).toBe(
      '"Contact Consultoria" <nao-responda@x.test>',
    );
    expect(fromHeader('nao-responda@x.test', 'A "B"\r\nBcc: c@d')).toBe(
      '"A B Bcc: c@d" <nao-responda@x.test>',
    );
    expect(fromHeader('Plataforma <nao-responda@x.test>')).toBe('Plataforma <nao-responda@x.test>');
  });
});
