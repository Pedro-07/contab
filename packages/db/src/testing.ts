/** Utilitários para testes e scripts. Uso restrito pelo lint. */
export { createDb, setDefaultDb, getDb, type Db } from './internal';
export { installDatabase } from './install';
export { seed, type SeedResult } from './seed-data';
export { rawClientOf } from './tenant';
