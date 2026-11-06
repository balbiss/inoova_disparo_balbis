import { Router } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { campaigns, connections, tenants } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { astra, AstraErro, clientIdDe, estadoDe, numeroDoJid } from '../lib/astra.js';
import { atualizarSaude, garantirWebhook } from '../lib/saude.js';
import { efetiva, limitesNumero } from '../lib/seguranca.js';

// Números de WhatsApp da empresa (cada um = uma sessão no AstraCalls).
export const connectionsRouter = Router();
connectionsRouter.use(exigirLogin, exigirEmpresa);

const erroAstra = (res: any, e: unknown) => {
  const err = e as AstraErro;
  res.status(err.status && err.status < 600 ? (err.status === 401 ? 502 : err.status) : 500).json({ error: err.message || 'Erro no servidor do WhatsApp.' });
};

async function daEmpresa(req: any) {
  const [c] = await db.select().from(connections).where(and(eq(connections.id, Number(req.params.id)), eq(connections.tenantId, tenantDe(req))));
  return c;
}

// foto de perfil do próprio número conectado (em memória, 12 h)
const fotos = new Map<number, { url: string | null; at: number; phone: string }>();
async function fotoDoNumero(c: typeof connections.$inferSelect, phone: string | null, conectado: boolean) {
  if (!phone || !conectado) return fotos.get(c.id)?.url ?? null;
  const f = fotos.get(c.id);
  if (f && f.phone === phone && Date.now() - f.at < 12 * 3600_000) return f.url;
  let url: string | null = null;
  try { const r = await astra<{ url?: string; profilePictureURL?: string }>('GET', `/api/sessions/${encodeURIComponent(c.sessionId)}/contacts/${phone}/picture?preview=true`, undefined, { timeoutMs: 10_000 }); url = r?.url || r?.profilePictureURL || null } catch { /* sem foto */ }
  fotos.set(c.id, { url, at: Date.now(), phone });
  return url;
}

async function comEstado(c: typeof connections.$inferSelect) {
  const st = await estadoDe(c.sessionId);
  const phone = numeroDoJid(st?.jid) || c.phone;
  if (st?.paired && phone && phone !== c.phone) await db.update(connections).set({ phone }).where(eq(connections.id, c.id));
  const restricao = c.restrictionActive && (!c.restrictionEndsAt || c.restrictionEndsAt > new Date());
  // uso de hoje com os limites padrão de mensagem (cada campanha pode ter os seus)
  const uso = await limitesNumero(c, await efetiva('message', {}));
  const pausado = c.pausedUntil && c.pausedUntil > new Date();
  return {
    id: c.id, name: c.name, phone, connected: !!st?.paired, state: st?.state || 'desconhecido', createdAt: c.createdAt,
    avatarUrl: await fotoDoNumero(c, phone, !!st?.paired),
    health: { restriction: restricao, restrictionEndsAt: restricao ? c.restrictionEndsAt : null, capping: c.cappingStatus, cappingRemaining: c.cappingRemaining, cappingTotal: c.cappingTotal, at: c.healthAt },
    seguranca: { pausedUntil: pausado ? c.pausedUntil : null, pauseReason: pausado ? c.pauseReason : null, nextAt: c.nextAt, ...uso },
  };
}

// recomeça o aquecimento (ex.: número trocado de chip ou que voltou de bloqueio)
connectionsRouter.post('/:id/reset-warmup', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  await db.update(connections).set({ warmupSince: new Date() }).where(eq(connections.id, c.id));
  res.json({ ok: true });
});

// consulta a saúde do número agora (restrição e limite de conversas novas)
connectionsRouter.post('/:id/health', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  await atualizarSaude(c, true);
  const [novo] = await db.select().from(connections).where(eq(connections.id, c.id));
  res.json({ connection: await comEstado(novo) });
});

connectionsRouter.get('/', async (req, res) => {
  const l = await db.select().from(connections).where(eq(connections.tenantId, tenantDe(req))).orderBy(connections.id);
  res.json({ connections: await Promise.all(l.map(comEstado)) });
});

connectionsRouter.post('/', async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1, 'Dê um nome pro número.').max(60) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const tid = tenantDe(req);
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(connections).where(eq(connections.tenantId, tid));
  if (n >= t.maxConnections) return res.status(400).json({ error: `Seu plano permite ${t.maxConnections} número(s) de WhatsApp.` });
  try {
    const s = await astra<{ id: string }>('POST', '/api/sessions', { name: `${t.name} · ${p.data.name}`.slice(0, 80) }, { clientId: clientIdDe(tid) });
    const [c] = await db.insert(connections).values({ tenantId: tid, name: p.data.name, sessionId: s.id }).returning();
    garantirWebhook(c).catch(e => console.warn('[conexao] webhook', (e as Error).message));
    res.status(201).json({ connection: await comEstado(c) });
  } catch (e) { erroAstra(res, e) }
});

connectionsRouter.patch('/:id', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Nome inválido.' });
  await db.update(connections).set({ name: p.data.name }).where(eq(connections.id, c.id));
  res.json({ ok: true });
});

// grupos do WhatsApp deste número (pra extrair contatos ou disparar dentro deles)
connectionsRouter.get('/:id/groups', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    const l = await astra<any[]>('GET', `/api/sessions/${encodeURIComponent(c.sessionId)}/groups`, undefined, { timeoutMs: 60_000 });
    const grupos = (l || []).filter(g => !g.isCommunity).map(g => ({
      jid: String(g.jid || g.id), name: String(g.name || g.subject || 'Grupo sem nome'), participants: (g.participants || []).length,
      withPhone: (g.participants || []).filter((p: any) => p.phone).length, announce: !!g.announce,
    })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    res.json({ groups: grupos });
  } catch (e) { erroAstra(res, e) }
});

// participantes de um grupo (nome e telefone) — pra ver antes de extrair ou baixar a planilha
connectionsRouter.get('/:id/groups/:jid/participants', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    const l = await astra<any[]>('GET', `/api/sessions/${encodeURIComponent(c.sessionId)}/groups`, undefined, { timeoutMs: 60_000 });
    const g = (l || []).find(x => String(x.jid || x.id) === req.params.jid);
    if (!g) return res.status(404).json({ error: 'Grupo não encontrado.' });
    const meu = String(c.phone || '').replace(/D/g, '');
    const participantes = (g.participants || []).map((p: any) => ({
      name: String(p.name || ''), phone: String(p.phone || '').replace(/D/g, ''), admin: !!(p.isAdmin || p.isSuperAdmin || p.admin),
      eu: !!meu && String(p.phone || '').replace(/D/g, '').slice(-8) === meu.slice(-8),
    }));
    res.json({ group: { jid: String(g.jid || g.id), name: String(g.name || g.subject || 'Grupo') }, participants: participantes });
  } catch (e) { erroAstra(res, e) }
});

// estado + QR (a tela consulta a cada 2 s enquanto o QR está aberto)
connectionsRouter.get('/:id/status', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  const st = await estadoDe(c.sessionId);
  res.json({ ...(await comEstado(c)), qr: st && !st.paired ? st.qr ?? null : null });
});

// gera o QR
connectionsRouter.post('/:id/qr', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    await astra('POST', `/api/sessions/${encodeURIComponent(c.sessionId)}/pair`, undefined, { clientId: clientIdDe(c.tenantId) });
    res.json({ ok: true });
  } catch (e) {
    if (/already paired/i.test((e as Error).message)) return res.json({ ok: true, connected: true });
    erroAstra(res, e);
  }
});

// alternativa ao QR: código de 8 letras digitado no celular
connectionsRouter.post('/:id/pair-code', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  let phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (phone.length === 10 || phone.length === 11) phone = '55' + phone;
  if (phone.length < 12) return res.status(400).json({ error: 'Informe o número com DDD.' });
  try {
    const r = await astra<{ code: string }>('POST', `/api/sessions/${encodeURIComponent(c.sessionId)}/pair-code`, { phone }, { clientId: clientIdDe(c.tenantId) });
    res.json({ code: r.code });
  } catch (e) { erroAstra(res, e) }
});

connectionsRouter.post('/:id/logout', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    await astra('POST', `/api/sessions/${encodeURIComponent(c.sessionId)}/logout`, undefined, { clientId: clientIdDe(c.tenantId) });
    await estadoDe(c.sessionId, true);
    res.json({ ok: true });
  } catch (e) { erroAstra(res, e) }
});

connectionsRouter.delete('/:id', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Número não encontrado.' });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campaigns)
    .where(and(sql`(${campaigns.connectionId} = ${c.id} or ${campaigns.connectionIds} @> ${JSON.stringify([c.id])}::jsonb)`, inArray(campaigns.status, ['running', 'paused', 'scheduled'])));
  if (n > 0) return res.status(400).json({ error: 'Esse número tem campanha em andamento ou pausada. Cancele ou conclua antes de remover.' });
  try {
    await astra('DELETE', `/api/sessions/${encodeURIComponent(c.sessionId)}`, undefined, { clientId: clientIdDe(c.tenantId) });
  } catch (e) {
    if ((e as AstraErro).status !== 404) return erroAstra(res, e);
  }
  await db.delete(connections).where(eq(connections.id, c.id));
  res.json({ ok: true });
});
