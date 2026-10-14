import { getDb } from '../internal';
import { seed } from '../seed-data';

if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') {
  console.error('O seed só roda fora de produção.');
  process.exit(1);
}

const result = await seed();
console.log(
  `Seed pronto: ${result.alfa.slug} e ${result.beta.slug}, ${Object.keys(result.users).length} usuários.`,
);
await getDb().$client.end();
