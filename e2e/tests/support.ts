import { expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';

const MAILPIT = 'http://localhost:8025/api/v1';

/** Espera um e-mail para o destinatário e devolve o primeiro link do texto. */
export async function linkFromEmail(to: string, contains: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: Array<{ ID: string }> };
    for (const m of messages ?? []) {
      const message = (await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()) as {
        Text: string;
      };
      const link = message.Text.match(/https?:\/\/\S+/)?.[0];
      if (link?.includes(contains)) {
        await fetch(`${MAILPIT}/messages`, {
          method: 'DELETE',
          body: JSON.stringify({ IDs: [m.ID] }),
        });
        return link;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nenhum e-mail para ${to} com ${contains}`);
}

/** Entra pelo link mágico usando só o teclado no formulário. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
  await page.goto(await linkFromEmail(email, '/api/auth/magic-link/verify'));
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function totp(secretBase32: string, now = Date.now()): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secretBase32.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
