/**
 * Incremento 4 no navegador, em 360 px, com a Serpro simulada (respostas gravadas do trial)
 * e o WhatsApp simulado (copiado para o Mailpit): o dono conecta a Receita pelo termo
 * assinado, pede "Buscar agora" na ficha e o DAS do Simples sai sozinho, publicado e
 * entregue ao cliente com a linha digitável lida do PDF.
 *
 * Usa o Escritório Beta, que nenhum outro teste do navegador usa.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, totp } from './support';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MAILPIT = 'http://localhost:8025/api/v1';
const JOAO = '5598990000001@whatsapp.simulado';
const LINE = '858700000006581503282225430720222149018016787725';
const TERM = Buffer.from(
  '<?xml version="1.0"?><termoDeAutorizacao><dados>fictício</dados><Signature>assinatura</Signature></termoDeAutorizacao>',
);

async function simulatedWhatsApp(template: string, contains: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const search = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${JOAO}"`)}`);
    const { messages } = (await search.json()) as {
      messages: Array<{ ID: string; Subject: string }>;
    };
    for (const m of (messages ?? []).filter((x) => x.Subject.includes(template))) {
      const message = (await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()) as {
        Text: string;
      };
      if (!message.Text.includes(contains)) continue;
      await fetch(`${MAILPIT}/messages`, {
        method: 'DELETE',
        body: JSON.stringify({ IDs: [m.ID] }),
      });
      return message.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nenhuma mensagem simulada ${template}`);
}

async function reloadUntil(page: Page, check: () => Promise<boolean>, timeout = 45_000) {
  await expect
    .poll(
      async () => {
        await page.reload();
        return check();
      },
      { timeout, intervals: [1000] },
    )
    .toBe(true);
}

test('dono conecta a Receita e o DAS do Simples sai sozinho para o cliente', async ({ page }) => {
  await login(page, 'dono@beta.test');
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole('button', { name: 'Configurar aplicativo autenticador' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: 'Escritório Beta (fictício)' })).toBeVisible();

  // WhatsApp do Beta (simulado), para a guia chegar ao cliente.
  await page.getByRole('link', { name: 'Conexões' }).click();
  await page.getByLabel('ID do app (Meta for Developers)').fill('123456789');
  await page.getByLabel('WABA ID (conta do WhatsApp Business)').fill('987654321');
  await page.getByLabel('Phone Number ID').fill('555666777888');
  await page
    .getByLabel('Token permanente do usuário do sistema')
    .fill('token-de-teste-com-mais-de-vinte');
  await page.getByLabel('App secret').fill('0123456789abcdef0123456789abcdef');
  await page.getByRole('button', { name: 'Conectar' }).click();
  await expect(page.getByText('WhatsApp conectado')).toBeVisible();
  await reloadUntil(page, async () => (await page.getByText('Aprovado').count()) === 6);

  // Conexões › Receita Federal, modo plataforma: só o termo assinado, sem certificado.
  await page.getByRole('link', { name: 'Conexões › Receita Federal →' }).click();
  await expect(page.getByRole('heading', { name: 'Conexões › Receita Federal' })).toBeVisible();
  await page.getByLabel('CNPJ do escritório').first().fill('44.555.666/0001-81');
  await page.getByLabel('Termo de autorização assinado (XML)').setInputFiles({
    name: 'termo.xml',
    mimeType: 'application/xml',
    buffer: TERM,
  });
  await page.getByLabel('Termo válido até').fill('2030-12-31');
  await page.getByRole('button', { name: 'Enviar termo' }).click();
  await expect(page.getByText('Termo recebido')).toBeVisible();
  await reloadUntil(page, async () => (await page.getByText('Ativa', { exact: true }).count()) > 0);

  // Ficha da empresa: "Buscar agora" acha a declaração e gera o DAS.
  await page.getByRole('link', { name: 'Clientes' }).click();
  await page
    .getByRole('link', { name: /Padaria/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Receita Federal' })).toBeVisible();
  await page.getByRole('button', { name: 'Buscar agora' }).click();
  await expect(page.getByText('Consulta enviada à Receita')).toBeVisible();
  await reloadUntil(page, async () => (await page.getByText(/Guia gerada/).count()) > 0);
  await page.getByRole('link', { name: 'ver guia', exact: true }).click();
  await expect(page.getByText('Gerada pela Receita Federal')).toBeVisible();
  await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(LINE)).toBeVisible();

  // O cliente recebe no WhatsApp e abre o link no endereço do Beta.
  const text = await simulatedWhatsApp('guia_disponivel_v1', 'R$ 58,15');
  const linkPath = /link: (\/g\/[\w-]+)/.exec(text)![1]!;
  await page.goto(`http://beta.localhost:3000${linkPath}`);
  await expect(page.getByText('R$ 58,15')).toBeVisible();
  await expect(page.getByText(LINE)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Baixar a guia em PDF' })).toBeVisible();
});
