import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './db/migrate.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { usersRouter } from './routes/users.js';
import { connectionsRouter } from './routes/connections.js';
import { contactsRouter } from './routes/contacts.js';
import { campaignsRouter } from './routes/campaigns.js';
import { dashboardRouter } from './routes/dashboard.js';
import { iniciarEventosAstra } from './lib/astra.js';
import { iniciarWorker } from './lib/worker.js';
import { iniciarSaude } from './lib/saude.js';
import { juntarConversasDuplicadas } from './lib/conversas.js';
import { isNull } from 'drizzle-orm';
import { db } from './db/client.js';
import { conversations } from './db/schema.js';
import { webhooksRouter } from './routes/webhooks.js';
import { conversationsRouter } from './routes/conversations.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean).length ? process.env.CORS_ORIGIN!.split(',') : true }));
// webhook do AstraCalls antes do express.json: a assinatura é conferida sobre o corpo cru
app.use('/api/webhooks', webhooksRouter);
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/users', usersRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/conversations', conversationsRouter);
if (process.env.ENABLE_TEST_ROUTES === '1' && process.env.NODE_ENV !== 'production') {
  const { testesRouter } = await import('./routes/testes.js');
  app.use('/api/_test', testesRouter);
  console.warn('[api] rotas de TESTE ligadas (/api/_test) — nunca use em produção');
}

// em produção o mesmo container serve o painel (pasta web/ com o build do Vite)
const web = path.resolve(process.env.WEB_DIR || './web');
if (fs.existsSync(path.join(web, 'index.html'))) {
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno.' });
});

const PORT = Number(process.env.PORT || 3020);

// o banco pode subir depois da API (Swarm/compose): tenta por até ~2 min antes de desistir
async function iniciar() {
  for (let tentativa = 1; ; tentativa++) {
    try { await runMigrations(); break }
    catch (e) {
      if (tentativa >= 60) { console.error('[api] banco indisponível, desistindo:', e); process.exit(1) }
      console.warn(`[api] aguardando o banco (tentativa ${tentativa}): ${(e as Error).message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  // quem ficou sem foto busca de novo (ex.: correção do 9º dígito na busca da foto)
  await db.update(conversations).set({ profileAt: null }).where(isNull(conversations.avatarUrl)).catch(() => {});
  await juntarConversasDuplicadas().catch(e => console.warn('[conversas] juntar duplicadas:', (e as Error).message));
  iniciarEventosAstra();
  iniciarWorker();
  iniciarSaude();
  app.listen(PORT, () => console.log(`[api] ouvindo na porta ${PORT}`));
}
void iniciar();
