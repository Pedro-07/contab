import { installDatabase } from '../install';

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error('DATABASE_MIGRATOR_URL não definida');
  process.exit(1);
}

await installDatabase(url);
console.log('Migrações aplicadas.');
