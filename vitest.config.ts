import { defineConfig } from 'vitest/config';

// Valores de teste (sem segredos reais). No CI, os mesmos valores.
process.loadEnvFile('.env.test');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
        },
      },
      {
        test: {
          // Banco real com RLS. Bloqueia o merge (plano, seção 12).
          name: 'integracao',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
