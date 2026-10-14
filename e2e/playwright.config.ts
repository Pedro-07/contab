import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(`${root}.env.test`);
// O worker avisa que está pronto pelo log.
process.env.LOG_LEVEL = 'info';

// No CI, a web roda o build de produção; localmente, o modo dev.
const web = process.env.CI ? 'pnpm --filter @contab/web start' : 'pnpm --filter @contab/web dev';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://app.localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // O plano exige o painel 100% funcional em 360 px.
      name: 'celular-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: [
    {
      command: web,
      cwd: root,
      url: 'http://localhost:3000/api/auth/ok',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: process.env as Record<string, string>,
    },
    {
      command: 'pnpm --filter @contab/worker start',
      cwd: root,
      reuseExistingServer: !process.env.CI,
      env: process.env as Record<string, string>,
      wait: { stdout: /worker registrado/ },
      timeout: 60_000,
    },
  ],
});
