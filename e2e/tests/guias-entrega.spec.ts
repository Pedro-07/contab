/**
 * Incremento 3 no navegador, em 360 px (WhatsApp simulado, copiado para o Mailpit):
 * o admin conecta o WhatsApp, cria e publica uma guia avulsa; o cliente recebe a mensagem
 * com o link seguro, vê o Pix e o QR; o escritório dá baixa; o cliente entra no portal com
 * o código que chega pelo WhatsApp.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, totp } from './support';

// O primeiro teste faz muita coisa (MFA, conexão, aprovação dos modelos, guia).
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MAILPIT = 'http://localhost:8025/api/v1';
const JOAO = '5598990000001@whatsapp.simulado';
const PIX =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
const PDF = Buffer.from('%PDF-1.7\n% guia fictícia do E2E\n%%EOF\n');

/** Espera a mensagem simulada (no Mailpit) com o template dado e devolve o texto. */
async function simulatedWhatsApp(template: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const search = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${JOAO}"`)}`);
    const { messages } = (await search.json()) as {
      messages: Array<{ ID: string; Subject: string }>;
    };
    const hit = (messages ?? []).find((m) => m.Subject.includes(template));
    if (hit) {
      const message = (await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json()) as {
        Text: string;
      };
      await fetch(`${MAILPIT}/messages`, {
        method: 'DELETE',
        body: JSON.stringify({ IDs: [hit.ID] }),
      });
      return message.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nenhuma mensagem simulada ${template}`);
}

async function reloadUntil(page: Page, check: () => Promise<boolean>, timeout = 30_000) {
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

let linkPath = '';
let guideUrl = '';

test('admin conecta o WhatsApp, publica a guia e o cliente recebe com Pix e link', async ({
  page,
}) => {
  await login(page, 'admin@alfa.test');
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole('button', { name: 'Configurar aplicativo autenticador' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();

  // Conexões › WhatsApp (conexão manual com o provedor simulado).
  await page.getByRole('link', { name: 'Conexões' }).click();
  await page.getByLabel('ID do app (Meta for Developers)').fill('123456789');
  await page.getByLabel('WABA ID (conta do WhatsApp Business)').fill('987654321');
  await page.getByLabel('Phone Number ID').fill('111222333444');
  await page
    .getByLabel('Token permanente do usuário do sistema')
    .fill('token-de-teste-com-mais-de-vinte');
  await page.getByLabel('App secret').fill('0123456789abcdef0123456789abcdef');
  await page.getByRole('button', { name: 'Conectar' }).click();
  await expect(page.getByText('WhatsApp conectado')).toBeVisible();
  await expect(page.getByText(/\/api\/webhooks\/whatsapp\//)).toBeVisible();
  // O worker submete os modelos; o simulado aprova na hora.
  await reloadUntil(page, async () => (await page.getByText('Aprovado').count()) === 6);

  // Guia avulsa: criar, enviar o PDF e publicar.
  await page.goto('/guias/nova');
  await page.getByLabel('Empresa').selectOption({ label: 'Padaria' });
  await page.getByLabel('Tipo').selectOption({ label: 'DAS do Simples' });
  await page.getByLabel('Competência (MM/AAAA)').fill('11/2030');
  await page.getByLabel('Vencimento').fill('2030-12-20');
  await page.getByLabel('Valor (R$)').fill('1.234,56');
  await page.getByLabel('Pix copia e cola').fill(PIX);
  await page.getByRole('button', { name: 'Criar guia' }).click();
  await expect(page).toHaveURL(/\/guias\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'DAS do Simples 11/2030' })).toBeVisible();
  guideUrl = page.url();

  await page.locator('#guide-pdf').setInputFiles({
    name: 'das.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await page.getByRole('button', { name: 'Enviar PDF' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar e enviar ao cliente' }).click();
  // A seção de publicar some; a situação da guia passa a "Publicada".
  await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible();

  // O worker envia; a mensagem simulada chega e a linha do tempo mostra o envio.
  const text = await simulatedWhatsApp('guia_disponivel_v1');
  expect(text).toContain('R$ 1.234,56');
  expect(text).toContain('20/12/2030');
  linkPath = /link: (\/g\/[\w-]+)/.exec(text)![1]!;
  await reloadUntil(page, async () => (await page.getByText('Enviado').count()) > 0);

  // O cliente abre o link no endereço do escritório: Pix, QR e PDF, sem login.
  const client = await page
    .context()
    .browser()!
    .newPage({ viewport: { width: 360, height: 740 } });
  await client.goto(`http://alfa.localhost:3000${linkPath}`);
  await expect(client.getByText('R$ 1.234,56')).toBeVisible();
  await expect(client.getByRole('img', { name: 'QR code do Pix' })).toBeVisible();
  await expect(client.getByRole('link', { name: 'Baixar a guia em PDF' })).toBeVisible();
  // O link do Alfa não abre no endereço do Beta.
  await client.goto(`http://beta.localhost:3000${linkPath}`);
  await expect(client.getByText('não é deste escritório')).toBeVisible();
  await client.close();
});

test('o escritório dá baixa e o link passa a dizer que está paga', async ({ page }) => {
  await login(page, 'contador@alfa.test');
  await page.goto(guideUrl);
  await page.getByText('Registrar pagamento').click();
  await page.getByLabel('Como o pagamento foi confirmado?').fill('comprovante no WhatsApp');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  // O formulário some quando a guia vira paga; a situação confirma a baixa.
  await expect(page.getByText('Paga', { exact: true }).first()).toBeVisible();
  expect(await simulatedWhatsApp('pagamento_confirmado_v1')).toContain('Padaria');

  await page.goto(`http://alfa.localhost:3000${linkPath}`);
  await expect(page.getByText('Esta guia já está paga')).toBeVisible();
});

test('o cliente entra no portal com o código do WhatsApp', async ({ page }) => {
  await page.goto('http://alfa.localhost:3000/');
  await page.getByRole('link', { name: 'Entrar com o código no WhatsApp' }).click();
  await page.getByLabel('Seu celular (com DDD)').fill('(98) 99000-0001');
  await page.getByRole('button', { name: 'Receber código' }).click();
  await expect(page.getByText('você vai receber um código')).toBeVisible();
  const code = /\{\{1\}\} (\d{6})/.exec(await simulatedWhatsApp('codigo_acesso_v1'))![1]!;

  await page.getByLabel('Código de 6 dígitos').fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Código inválido' })).toBeVisible();

  await page.getByLabel('Código de 6 dígitos').fill(code);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('João Fictício')).toBeVisible();
  await expect(page.getByLabel('Empresa')).toBeVisible();
});
