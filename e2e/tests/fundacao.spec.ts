/**
 * Fluxos da Fundação no navegador, em 360 px: login por link mágico, MFA do dono,
 * convite de ponta a ponta (com o worker), troca de organização e portal por subdomínio.
 */
import { expect, test } from '@playwright/test';
import { linkFromEmail, login, totp } from './support';

test.describe.configure({ mode: 'serial' });

test('dono configura o TOTP, convida um contador e o contador entra', async ({ page, browser }) => {
  await login(page, 'dono@alfa.test');

  // MFA obrigatório para o dono.
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole('button', { name: 'Configurar aplicativo autenticador' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10);
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();

  // Convite: criado no painel, enviado pelo worker, aceito em outro navegador.
  await page.getByRole('link', { name: 'Convites' }).click();
  await page.getByLabel('E-mail').fill('novo.contador@alfa.test');
  await page.getByLabel('Papel').selectOption('contador');
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByRole('status')).toContainText('Convite criado');

  const inviteLink = await linkFromEmail('novo.contador@alfa.test', '/convite/');
  const guest = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await guest.goto(inviteLink);
  await expect(guest.getByRole('heading', { name: /Convite para Escritório Alfa/ })).toBeVisible();
  await guest.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(guest.getByRole('status')).toContainText('Convite aceito');

  // O mesmo link não vale de novo.
  await guest.goto(inviteLink);
  await expect(guest.getByRole('heading', { name: 'Convite indisponível' })).toBeVisible();

  // O link mágico chega e o contador entra sem MFA, sem acesso a Membros.
  await guest.goto(await linkFromEmail('novo.contador@alfa.test', '/api/auth/magic-link/verify'));
  await expect(guest.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();
  await expect(guest.getByText('Você está como')).toContainText('Contador');
  await expect(guest.getByRole('link', { name: 'Membros' })).toHaveCount(0);

  // Acesso direto à página de membros: recusado.
  await guest.goto('/membros');
  // Filtra pelo texto: no build de produção o Next também põe um role="alert" (o anunciador de rota).
  await expect(guest.getByRole('alert').filter({ hasText: 'não permite' })).toBeVisible();

  // A auditoria do dono mostra o aceite.
  await page.getByRole('link', { name: 'Auditoria' }).click();
  await expect(page.getByText('convite.aceito')).toBeVisible();
  await guest.close();
});

test('quem está em dois escritórios escolhe e troca sem misturar dados', async ({ page }) => {
  await login(page, 'duplo@teste.test');
  await expect(page).toHaveURL(/\/organizacoes$/);
  await page.getByRole('button', { name: 'Entrar em Escritório Beta (fictício)' }).click();
  await expect(page.getByRole('heading', { name: 'Escritório Beta (fictício)' })).toBeVisible();
  await expect(page.getByText('Você está como')).toContainText('Contador');

  await page.getByRole('link', { name: 'Trocar escritório' }).click();
  await page.getByRole('button', { name: 'Entrar em Escritório Alfa (fictício)' }).click();
  await expect(page.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();
  await expect(page.getByText('Você está como')).toContainText('Atendente');
});

test('portal por subdomínio e cookie preso ao host do painel', async ({ page, context }) => {
  await login(page, 'atendente@alfa.test');
  await expect(page.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();

  // A sessão do painel não vai para o subdomínio do portal.
  const portalCookies = await context.cookies('http://alfa.localhost:3000');
  expect(portalCookies.some((c) => c.name.includes('session'))).toBe(false);

  await page.goto('http://alfa.localhost:3000/');
  await expect(page.getByRole('heading', { name: 'Escritório Alfa (fictício)' })).toBeVisible();
  await page.goto('http://beta.localhost:3000/');
  await expect(page.getByRole('heading', { name: 'Escritório Beta (fictício)' })).toBeVisible();

  for (const host of ['www', 'inexistente']) {
    const response = await page.goto(`http://${host}.localhost:3000/`);
    expect(response?.status(), host).toBe(404);
  }

  // Caminho interno digitado direto não abre nada.
  const direct = await page.goto('http://app.localhost:3000/painel/membros');
  expect(direct?.status()).toBe(404);
});

test('sair encerra a sessão', async ({ page }) => {
  await login(page, 'atendente@alfa.test');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar$/);
});
