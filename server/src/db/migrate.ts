import { fileURLToPath } from 'node:url';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client.js';
import { users } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// em dev roda de src/db, no build de dist/db — a pasta drizzle fica sempre na raiz do server
const migrationsFolder = path.resolve(here, '../../drizzle');

/** Aplica as migrações e garante o superadmin (SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD). */
export async function runMigrations() {
  await migrate(db, { migrationsFolder });
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.SUPERADMIN_PASSWORD || '';
  if (email && senha) {
    const [ja] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!ja) {
      await db.insert(users).values({ name: 'Administrador', email, passwordHash: await bcrypt.hash(senha, 10), role: 'superadmin', tenantId: null });
      console.log(`[migrate] superadmin criado: ${email}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().then(() => { console.log('[migrate] ok'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) });
}
