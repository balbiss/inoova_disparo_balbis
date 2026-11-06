import { Router } from 'express';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { conversations, conversationTags, quickReplies, tags } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';

// Respostas rápidas ("/preco" nas Conversas) e etiquetas das conversas (mini funil).
export const extrasRouter = Router();
// login só nas rotas deste arquivo (o router fica montado em /api)
extrasRouter.use(['/quick-replies', '/tags', '/conversations/:id/tags'], exigirLogin, exigirEmpresa);

// --- respostas rápidas --------------------------------------------------------------------------
const atalho = (s: string) => s.trim().toLowerCase().replace(/^\//, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]/g, '');

extrasRouter.get('/quick-replies', async (req, res) => {
  const l = await db.select().from(quickReplies).where(eq(quickReplies.tenantId, tenantDe(req))).orderBy(asc(quickReplies.shortcut));
  res.json({ quickReplies: l });
});

const qrSchema = z.object({ shortcut: z.string().max(40), text: z.string().trim().min(1, 'Escreva a mensagem.').max(4096) });

extrasRouter.post('/quick-replies', async (req, res) => {
  const p = qrSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const sc = atalho(p.data.shortcut);
  if (!sc) return res.status(400).json({ error: 'Dê um atalho (ex.: preco).' });
  const [r] = await db.insert(quickReplies).values({ tenantId: tenantDe(req), shortcut: sc, text: p.data.text }).onConflictDoNothing().returning();
  if (!r) return res.status(409).json({ error: `Já existe a resposta /${sc}.` });
  res.status(201).json({ quickReply: r });
});

extrasRouter.patch('/quick-replies/:id', async (req, res) => {
  const p = qrSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const set: Partial<typeof quickReplies.$inferInsert> = {};
  if (p.data.shortcut !== undefined) { const sc = atalho(p.data.shortcut); if (!sc) return res.status(400).json({ error: 'Atalho inválido.' }); set.shortcut = sc }
  if (p.data.text !== undefined) set.text = p.data.text;
  try {
    const [r] = await db.update(quickReplies).set(set).where(and(eq(quickReplies.id, Number(req.params.id)), eq(quickReplies.tenantId, tenantDe(req)))).returning();
    if (!r) return res.status(404).json({ error: 'Resposta não encontrada.' });
    res.json({ quickReply: r });
  } catch { res.status(409).json({ error: 'Já existe outra resposta com esse atalho.' }) }
});

extrasRouter.delete('/quick-replies/:id', async (req, res) => {
  await db.delete(quickReplies).where(and(eq(quickReplies.id, Number(req.params.id)), eq(quickReplies.tenantId, tenantDe(req))));
  res.json({ ok: true });
});

// --- etiquetas ----------------------------------------------------------------------------------
const PADRAO = [
  { name: 'Interessado', color: '#00A884' },
  { name: 'Negociando', color: '#F5A524' },
  { name: 'Fechou', color: '#3B82F6' },
  { name: 'Sem interesse', color: '#8696A0' },
];

/** Etiquetas da empresa (cria as padrão na primeira vez). */
export async function etiquetasDa(tenantId: number) {
  let l = await db.select().from(tags).where(eq(tags.tenantId, tenantId)).orderBy(asc(tags.position), asc(tags.id));
  if (!l.length) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tags).where(eq(tags.tenantId, tenantId));
    if (!n) {
      await db.insert(tags).values(PADRAO.map((t, i) => ({ ...t, tenantId, position: i })));
      l = await db.select().from(tags).where(eq(tags.tenantId, tenantId)).orderBy(asc(tags.position), asc(tags.id));
    }
  }
  return l;
}

extrasRouter.get('/tags', async (req, res) => {
  const tid = tenantDe(req);
  const l = await etiquetasDa(tid);
  const cont = await db.select({ tagId: conversationTags.tagId, n: sql<number>`count(*)::int` }).from(conversationTags)
    .innerJoin(conversations, eq(conversations.id, conversationTags.conversationId)).where(eq(conversations.tenantId, tid)).groupBy(conversationTags.tagId);
  const m = new Map(cont.map(c => [c.tagId, c.n]));
  res.json({ tags: l.map(t => ({ ...t, total: m.get(t.id) ?? 0 })) });
});

const tagSchema = z.object({ name: z.string().trim().min(1, 'Dê um nome à etiqueta.').max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#128C7E') });

extrasRouter.post('/tags', async (req, res) => {
  const p = tagSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const tid = tenantDe(req);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${tags.position}), -1)::int` }).from(tags).where(eq(tags.tenantId, tid));
  const [t] = await db.insert(tags).values({ ...p.data, tenantId: tid, position: max + 1 }).returning();
  res.status(201).json({ tag: t });
});

extrasRouter.patch('/tags/:id', async (req, res) => {
  const p = tagSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [t] = await db.update(tags).set(p.data).where(and(eq(tags.id, Number(req.params.id)), eq(tags.tenantId, tenantDe(req)))).returning();
  if (!t) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  res.json({ tag: t });
});

extrasRouter.delete('/tags/:id', async (req, res) => {
  await db.delete(tags).where(and(eq(tags.id, Number(req.params.id)), eq(tags.tenantId, tenantDe(req))));
  res.json({ ok: true });
});

// etiquetas de uma conversa (substitui a lista)
extrasRouter.put('/conversations/:id/tags', async (req, res) => {
  const tid = tenantDe(req);
  const p = z.object({ tagIds: z.array(z.number().int()).max(20) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Etiquetas inválidas.' });
  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, Number(req.params.id)), eq(conversations.tenantId, tid)));
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const validas = p.data.tagIds.length ? await db.select({ id: tags.id }).from(tags).where(and(eq(tags.tenantId, tid), inArray(tags.id, p.data.tagIds))) : [];
  await db.delete(conversationTags).where(eq(conversationTags.conversationId, conv.id));
  if (validas.length) await db.insert(conversationTags).values(validas.map(v => ({ conversationId: conv.id, tagId: v.id }))).onConflictDoNothing();
  res.json({ tagIds: validas.map(v => v.id) });
});
