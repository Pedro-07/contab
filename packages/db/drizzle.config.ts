import { defineConfig } from 'drizzle-kit';

// Só gera SQL a partir do schema; não precisa de banco.
// RLS, papéis e funções ficam em migrações escritas à mão (drizzle-kit generate --custom).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
});
