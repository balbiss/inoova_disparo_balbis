import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');

// DB_POOL_MAX=1 no desenvolvimento com PGlite (só aceita uma conexão por vez).
export const sql = postgres(url, { max: Number(process.env.DB_POOL_MAX || 10), onnotice: () => {} });
export const db = drizzle(sql, { schema });
