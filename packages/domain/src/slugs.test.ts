import { describe, expect, it } from 'vitest';
import { isValidSlug, resolveHost } from './slugs';

describe('slugs e hosts (P16)', () => {
  it('recusa slugs reservados e inválidos', () => {
    expect(isValidSlug('contact')).toBe(true);
    expect(isValidSlug('app')).toBe(false);
    expect(isValidSlug('www')).toBe(false);
    expect(isValidSlug('Contact')).toBe(false);
    expect(isValidSlug('-contact')).toBe(false);
    expect(isValidSlug('ab')).toBe(false);
  });

  it('resolve painel e portal pelo host', () => {
    expect(resolveHost('app.localhost:3000', 'localhost:3000')).toEqual({ kind: 'painel' });
    expect(resolveHost('alfa.localhost:3000', 'localhost:3000')).toEqual({
      kind: 'portal',
      slug: 'alfa',
    });
    expect(resolveHost('APP.contab.app', 'contab.app')).toEqual({ kind: 'painel' });
  });

  it('host desconhecido não vira tenant', () => {
    expect(resolveHost('localhost:3000', 'localhost:3000')).toEqual({ kind: 'desconhecido' });
    expect(resolveHost('a.b.localhost:3000', 'localhost:3000')).toEqual({ kind: 'desconhecido' });
    expect(resolveHost('alfa.outro.com', 'localhost:3000')).toEqual({ kind: 'desconhecido' });
    expect(resolveHost('www.localhost:3000', 'localhost:3000')).toEqual({ kind: 'desconhecido' });
    expect(resolveHost(null, 'localhost:3000')).toEqual({ kind: 'desconhecido' });
  });
});
