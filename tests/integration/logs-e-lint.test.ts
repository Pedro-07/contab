/**
 * Logs sem conteúdo sensível (item 24) e regra de lint de acesso ao banco (item 11).
 */
import { createLogger } from '@contab/config/logger';
import { runWithLogContext } from '@contab/config/request-context';
import { listMembers, withTenant } from '@contab/db';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { describe, expect, inject, it } from 'vitest';
import { systemCtx } from './helpers';

const seed = inject('seed');

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination }) };
}

describe('logs (24)', () => {
  it('toda linha dentro de withTenant leva o tenant_id do contexto', async () => {
    const { lines, logger } = capture();
    await withTenant(systemCtx(seed.alfa.id), async (tx) => {
      await listMembers(tx);
      logger.info('dentro do tenant');
    });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      tenant_id: seed.alfa.id,
      msg: 'dentro do tenant',
    });
  });

  it('tokens, links, segredos e códigos nunca saem no log', () => {
    const { lines, logger } = capture();
    runWithLogContext({ requestId: 'r1', tenantId: seed.alfa.id }, () => {
      logger.info(
        {
          token: 'TOKEN-CONVITE',
          url: 'http://app.localhost:3000/convite/TOKEN-CONVITE',
          secret: 'SEGREDO-TOTP',
          code: '123456',
          backupCodes: ['RECUPERA-1'],
          headers: { cookie: 'painel.session_token=SESSAO', authorization: 'Bearer X' },
        },
        'evento',
      );
    });
    const out = lines.join('\n');
    for (const leaked of [
      'TOKEN-CONVITE',
      'SEGREDO-TOTP',
      '123456',
      'RECUPERA-1',
      'SESSAO',
      'Bearer X',
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(JSON.parse(lines[0]!)).toMatchObject({ request_id: 'r1', tenant_id: seed.alfa.id });
  });
});

describe('lint de acesso ao banco (11)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const eslint = new ESLint({ cwd: root });

  it.each([
    ["import pg from 'pg';", 'apps/web/src/server/x.ts'],
    ["import { createDb } from '@contab/db/internal';", 'packages/core/src/x.ts'],
    ["import { createDb } from '@contab/db/testing';", 'apps/worker/src/x.ts'],
    ["import { withTenant } from '@contab/db';", 'apps/web/src/components/x.tsx'],
  ])('%s em %s é recusado', async (code, filePath) => {
    const [result] = await eslint.lintText(`${code}\nexport {};\n`, {
      filePath: `${root}${filePath}`,
    });
    expect(result!.messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('o acesso pelo caminho certo é aceito', async () => {
    const [result] = await eslint.lintText(
      "import { withTenant } from '@contab/db';\nexport { withTenant };\n",
      {
        filePath: `${root}packages/core/src/x.ts`,
      },
    );
    expect(result!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toHaveLength(0);
  });
});
