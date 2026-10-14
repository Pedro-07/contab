/**
 * Criação do cliente de banco. Uso restrito (lint): só packages/db, scripts e testes.
 * O resto do código acessa o banco por withTenant, withUser ou pelos repositórios globais.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema> & { $client: pg.Pool };

export function createDb(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return drizzle({ client: pool, schema, casing: 'snake_case' }) as Db;
}

let defaultDb: Db | undefined;

/** Cliente padrão, com o papel `app` (DATABASE_URL). */
export function getDb(): Db {
  if (!defaultDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definida');
    defaultDb = createDb(url);
  }
  return defaultDb;
}

/** Usado pelos testes para apontar o cliente padrão para o banco de teste. */
export function setDefaultDb(db: Db | undefined): void {
  defaultDb = db;
}

export { schema };
