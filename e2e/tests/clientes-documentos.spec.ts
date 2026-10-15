/**
 * Incremento 2 no navegador, em 360 px: o contador importa um CSV, abre a ficha, envia
 * um PDF direto para o storage e o worker libera; João entra no portal, escolhe a
 * Padaria, baixa o PDF e, ao trocar para a Loja, o PDF da Padaria some (CA6).
 */
import { createPortalDevLink } from '@contab/core';
import { findContactByPhone, withTenant } from '@contab/db';
import { findTenantBySlug } from '@contab/db/global';
import { asTenantId } from '@contab/domain';
import { expect, test } from '@playwright/test';
import { login } from './support';

test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.7\n% contrato fictício para o E2E\n%%EOF\n');
const CSV = [
  'cnpj;razao_social;nome_fantasia;regime;contato_nome;contato_telefone;aceita_whatsapp;acesso_portal',
  '33.000.167/0001-01;Mercado Fictício Ltda;Mercado E2E;SN;Ana Fictícia;(98) 99444-0001;sim;sim',
  '00.000.000/0000-00;Linha com erro;;SN;;;;',
].join('\n');

async function portalLink(phone: string): Promise<string> {
  const tenant = (await findTenantBySlug('alfa'))!;
  const tenantId = asTenantId(tenant.id);
  const meta = { requestId: `e2e-${Date.now()}` };
  const contact = await withTenant(
    { tenantId, actor: { type: 'system', jobName: 'e2e', jobId: meta.requestId }, ...meta },
    (tx) => findContactByPhone(tx, phone),
  );
  const token = await createPortalDevLink('test', tenantId, contact!.id, meta);
  return `http://alfa.localhost:3000/entrar-dev/${token}`;
}

test('contador importa CSV, envia documento e o worker libera', async ({ page }) => {
  await login(page, 'contador@alfa.test');
  await page.getByRole('link', { name: 'Clientes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

  // Importação com prévia: uma linha boa, uma com erro.
  await page.getByRole('link', { name: 'Importar CSV' }).click();
  await page.getByLabel('Arquivo CSV').setInputFiles({
    name: 'clientes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Ver prévia' }).click();
  // Na segunda tentativa do CI a empresa já existe: a prévia diz "atualizada".
  await expect(page.getByText('Contatos: 1')).toBeVisible();
  await expect(page.getByText('Linha 3: CNPJ inválido.')).toBeVisible();
  await page.getByLabel(/Declaro que o escritório tem a autorização/).check();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Importação concluída' })).toContainText(
    '1 autorizações registradas',
  );

  // Ficha da Padaria (do seed), envio de PDF pela pasta "Contrato social".
  await page.goto('/clientes');
  await page.getByLabel('Buscar por nome ou CNPJ').fill('Padaria');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await page.getByRole('link', { name: 'Padaria', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Padaria', level: 1 })).toBeVisible();

  const form = page.getByRole('form', { name: 'Enviar documento' });
  await form.getByLabel('Pasta').selectOption('contrato_social');
  await form.getByLabel('Nome do documento (opcional)').fill('Contrato social E2E');
  await form.getByLabel('Arquivo', { exact: true }).setInputFiles({
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await form.getByRole('button', { name: 'Enviar documento' }).click();
  // O worker confere o arquivo e a página se atualiza sozinha.
  await expect(page.getByRole('link', { name: 'Baixar contrato.pdf' }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test('atendente vê a ficha, mas não altera', async ({ page }) => {
  await login(page, 'atendente@alfa.test');
  await page.goto('/clientes');
  await expect(page.getByRole('link', { name: 'Nova empresa' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Padaria', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Baixar contrato.pdf' }).first()).toBeVisible();
  await expect(page.getByRole('form', { name: 'Enviar documento' })).toHaveCount(0);
  await expect(page.getByText('Adicionar contato')).toHaveCount(0);
});

test('CA6: João escolhe a empresa no portal e só vê a empresa ativa', async ({ page }) => {
  await page.goto(await portalLink('+5598990000001'));
  await expect(page.getByText('João Fictício')).toBeVisible();

  // Duas empresas: precisa escolher.
  await page.getByLabel('Empresa').selectOption({ label: 'Padaria' });
  await page.getByRole('button', { name: 'Entrar na empresa' }).click();
  await expect(page.getByRole('heading', { name: 'Padaria', level: 1 })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Contrato social E2E' }).first().click();
  expect((await download).suggestedFilename()).toBe('contrato.pdf');

  await page.getByLabel('Empresa').selectOption({ label: 'Loja' });
  await page.getByRole('button', { name: 'Trocar de empresa' }).click();
  await expect(page.getByRole('heading', { name: 'Loja', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contrato social E2E' })).toHaveCount(0);

  // Sair revoga a sessão do portal.
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByText('Entre pelo link que o escritório enviou')).toBeVisible();
  await page.goto('http://alfa.localhost:3000/');
  await expect(page.getByText('Entre pelo link que o escritório enviou')).toBeVisible();
});

test('link do portal usado duas vezes não entra', async ({ page }) => {
  const link = await portalLink('+5598990000001');
  await page.goto(link);
  await expect(page.getByText('João Fictício')).toBeVisible();
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByRole('alert').filter({ hasText: 'não vale mais' })).toBeVisible();
});
