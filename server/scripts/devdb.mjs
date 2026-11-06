// Postgres de desenvolvimento sem Docker: PGlite servindo o protocolo do Postgres na porta 55450.
// Os dados ficam em server/.devdb. Rode `npm run devdb` num terminal e a API em outro.
// Só aceita 1 conexão por vez (por isso DB_POOL_MAX=1 no .env de dev).
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// a API reiniciar (tsx watch) derruba a conexão no meio: não pode matar o banco junto
process.on('uncaughtException', e => { if (e?.code !== 'ECONNRESET') console.error('[devdb]', e) });
process.on('unhandledRejection', e => console.error('[devdb]', e));

const db = await PGlite.create('./.devdb');
const port = Number(process.env.DEVDB_PORT || 55450);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log('[devdb] Postgres (PGlite) em 127.0.0.1:' + port);
const fim = async () => { await server.stop(); await db.close(); process.exit(0) };
process.on('SIGINT', fim);
process.on('SIGTERM', fim);
