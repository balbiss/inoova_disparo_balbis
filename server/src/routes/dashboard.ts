import { Router } from 'express';
import { and, count, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, contacts, conversations } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { estadoDe } from '../lib/astra.js';

export const dashboardRouter = Router();
dashboardRouter.use(exigirLogin, exigirEmpresa);

dashboardRouter.get('/', async (req, res) => {
  const tid = tenantDe(req);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const desde = new Date(Date.now() - 6 * 86400_000);
  desde.setHours(0, 0, 0, 0);

  const [{ n: totalContatos }] = await db.select({ n: count() }).from(contacts).where(eq(contacts.tenantId, tid));
  const conns = await db.select().from(connections).where(eq(connections.tenantId, tid));
  const estados = await Promise.all(conns.map(c => estadoDe(c.sessionId)));
  const ativas = await db.select({ id: campaigns.id, name: campaigns.name, kind: campaigns.kind, status: campaigns.status, pauseReason: campaigns.pauseReason, waitReason: campaigns.waitReason, scheduledAt: campaigns.scheduledAt })
    .from(campaigns).where(and(eq(campaigns.tenantId, tid), inArray(campaigns.status, ['running', 'paused', 'scheduled'])));
  // progresso de cada campanha ativa
  const progresso = ativas.length ? await db.select({ id: campaignTargets.campaignId, total: sql<number>`count(*)::int`, feitos: sql<number>`count(*) filter (where ${campaignTargets.status} not in ('pending','sending','warming','ringing','answered'))::int`, respostas: sql<number>`count(*) filter (where ${campaignTargets.repliedAt} is not null)::int` })
    .from(campaignTargets).where(inArray(campaignTargets.campaignId, ativas.map(a => a.id))).groupBy(campaignTargets.campaignId) : [];
  const prog = new Map(progresso.map(p => [p.id, p]));

  const doTenant = (cond: any) => db.select({ status: campaignTargets.status, doneAt: campaignTargets.doneAt })
    .from(campaignTargets).innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(and(eq(campaigns.tenantId, tid), cond));
  const semana = await doTenant(gte(campaignTargets.doneAt, desde));

  const dias: { dia: string; enviadas: number; ligacoes: number; falhas: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    dias.push({ dia: d.toISOString().slice(0, 10), enviadas: 0, ligacoes: 0, falhas: 0 });
  }
  let enviadasHoje = 0, atendidasHoje = 0, falhasHoje = 0;
  for (const t of semana) {
    if (!t.doneAt) continue;
    const dia = new Date(t.doneAt.getTime() - t.doneAt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const slot = dias.find(x => x.dia === dia);
    if (t.status === 'sent') slot && slot.enviadas++;
    else if (t.status === 'completed' || t.status === 'no-answer') slot && slot.ligacoes++;
    else if (t.status === 'failed') slot && slot.falhas++;
    if (t.doneAt >= hoje) {
      if (t.status === 'sent') enviadasHoje++;
      if (t.status === 'completed') atendidasHoje++;
      if (t.status === 'failed') falhasHoje++;
    }
  }

  const [{ n: respostasHoje }] = await db.select({ n: count() }).from(conversations)
    .where(and(eq(conversations.tenantId, tid), gte(conversations.lastInboundAt, hoje)));
  const [{ n: naoLidas }] = await db.select({ n: count() }).from(conversations)
    .where(and(eq(conversations.tenantId, tid), gt(conversations.unread, 0)));

  res.json({
    contatos: totalContatos,
    respostasHoje, naoLidas,
    conexoes: { total: conns.length, conectadas: estados.filter(e => e?.paired).length },
    hoje: { enviadas: enviadasHoje, atendidas: atendidasHoje, falhas: falhasHoje },
    ativas: ativas.map(a => ({ ...a, total: prog.get(a.id)?.total ?? 0, feitos: prog.get(a.id)?.feitos ?? 0, respostas: prog.get(a.id)?.respostas ?? 0 })),
    dias,
  });
});
