// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Regras de isolamento (incremento Fundação, teste 11):
 * - o cliente bruto do banco (pg, drizzle node-postgres, @contab/db/internal e /testing)
 *   só pode ser importado dentro de packages/db e em testes;
 * - o acesso a tabelas globais (@contab/db/global) só em auth, casos de uso, servidor da web,
 *   worker e testes. Componentes de interface nunca acessam o banco.
 */
const rawDbImports = {
  paths: [
    { name: 'pg', message: 'Use withTenant/withUser de @contab/db.' },
    { name: 'drizzle-orm/node-postgres', message: 'Use withTenant/withUser de @contab/db.' },
    { name: '@contab/db/internal', message: 'Cliente bruto do banco: só em packages/db.' },
    { name: '@contab/db/testing', message: 'Utilitários de teste: só em testes e scripts.' },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', rawDbImports],
    },
  },
  {
    files: ['packages/db/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.ts', 'tests/**', 'e2e/**', 'vitest.*.ts', '**/scripts/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Interface do navegador: nada de banco.
    files: [
      'apps/web/src/components/**',
      'apps/web/src/lib/**',
      'apps/web/src/**/*-form*.tsx',
      'apps/web/src/**/mfa-forms.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...rawDbImports,
          patterns: [
            {
              group: ['@contab/db', '@contab/db/*'],
              message: 'Componentes de interface não acessam o banco.',
            },
          ],
        },
      ],
    },
  },
);
