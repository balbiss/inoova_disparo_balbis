import crypto from 'node:crypto';
import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { conversaDe, gravarMensagem } from '../lib/conversas.js';

// Rotas SÓ PARA TESTE AUTOMÁTICO (montadas apenas com ENABLE_TEST_ROUTES=1, nunca em produção):
// simulam o que o WhatsApp faria, pra testar Conversas/relatório sem um número conectado.
export const testesRouter = Router();
testesRouter.use(exigirLogin, exigirEmpresa);

testesRouter.get('/connections/:id/secret', async (req, res) => {
  const [c] = await db.select().from(connections).where(and(eq(connections.id, Number(req.params.id)), eq(connections.tenantId, tenantDe(req))));
  if (!c) return res.status(404).end();
  let s = c.webhookSecret;
  if (!s) { s = crypto.randomBytes(16).toString('hex'); await db.update(connections).set({ webhookSecret: s }).where(eq(connections.id, c.id)) }
  res.json({ secret: s, sessionId: c.sessionId });
});

// marca os contatos na fila como "enviada" (astraRef = TEST-<id>) e põe a campanha como pedida
testesRouter.post('/campaigns/:id/simulate-sent', async (req, res) => {
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, Number(req.params.id)), eq(campaigns.tenantId, tenantDe(req))));
  if (!c) return res.status(404).end();
  const [conn] = await db.select().from(connections).where(eq(connections.id, c.connectionId!));
  const alvos = await db.select().from(campaignTargets).where(and(eq(campaignTargets.campaignId, c.id), eq(campaignTargets.status, 'pending')));
  for (const a of alvos) {
    await db.update(campaignTargets).set({ status: 'sent', astraRef: `TEST-${a.id}`, doneAt: new Date() }).where(eq(campaignTargets.id, a.id));
    const conv = await conversaDe(conn, a.phone, a.name);
    await gravarMensagem(conv, { waId: `TEST-${a.id}`, fromMe: true, text: c.text, campaignId: c.id });
  }
  if (req.body?.status) await db.update(campaigns).set({ status: req.body.status }).where(eq(campaigns.id, c.id));
  res.json({ refs: alvos.map(a => ({ phone: a.phone, ref: `TEST-${a.id}` })) });
});

// põe a campanha "rodando" com o próximo envio daqui a 1 h (o motor não mexe nela durante o teste)
testesRouter.post('/campaigns/:id/hold-running', async (req, res) => {
  const r = await db.update(campaigns).set({ status: 'running', nextAt: new Date(Date.now() + 3600_000), pauseReason: null })
    .where(and(eq(campaigns.id, Number(req.params.id)), eq(campaigns.tenantId, tenantDe(req)))).returning({ id: campaigns.id });
  res.status(r.length ? 200 : 404).json({ ok: !!r.length });
});
