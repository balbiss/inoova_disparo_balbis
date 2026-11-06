import { Router } from 'express';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { categories, leads, leadSearches } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { extratorConfigurado, iniciarBusca } from '../lib/leads.js';
import { importarLinhas } from './contacts.js';

export const leadsRouter = Router();
leadsRouter.use(exigirLogin, exigirEmpresa);

const BUSCAS_POR_DIA = Number(process.env.LEADS_BUSCAS_DIA || 30);

async function daEmpresa(req: any) {
  const [s] = await db.select().from(leadSearches).where(and(eq(leadSearches.id, Number(req.params.id)), eq(leadSearches.tenantId, tenantDe(req))));
  return s;
}

leadsRouter.get('/', async (req, res) => {
  const l = await db.select({
    s: leadSearches,
    comTelefone: sql<number>`(select count(*)::int from leads l where l.search_id = "lead_searches"."id" and l.phone is not null)`,
    celulares: sql<number>`(select count(*)::int from leads l where l.search_id = "lead_searches"."id" and l.mobile)`,
  }).from(leadSearches).where(eq(leadSearches.tenantId, tenantDe(req))).orderBy(desc(leadSearches.id)).limit(60);
  res.json({ configurado: extratorConfigurado(), searches: l.map(x => ({ ...x.s, jobId: undefined, comTelefone: x.comTelefone, celulares: x.celulares })) });
});

leadsRouter.post('/', async (req, res) => {
  if (!extratorConfigurado()) return res.status(503).json({ error: 'O extrator de leads ainda não foi ligado no servidor. Fale com o suporte.' });
  const p = z.object({
    query: z.string().trim().min(2, 'Diga o que procurar (ex.: pizzaria).').max(120),
    location: z.string().trim().max(120).default(''),
    maxResults: z.number().int().min(10).max(500).default(50),
    withEmail: z.boolean().default(false),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const tid = tenantDe(req);
  const [{ ativas }] = await db.select({ ativas: count() }).from(leadSearches).where(and(eq(leadSearches.tenantId, tid), inArray(leadSearches.status, ['pending', 'working'])));
  if (ativas > 0) return res.status(409).json({ error: 'Já tem uma busca em andamento. Espere ela terminar pra começar outra.' });
  const [{ hoje }] = await db.select({ hoje: count() }).from(leadSearches).where(and(eq(leadSearches.tenantId, tid), gte(leadSearches.createdAt, new Date(Date.now() - 86400_000))));
  if (hoje >= BUSCAS_POR_DIA) return res.status(429).json({ error: `Limite de ${BUSCAS_POR_DIA} buscas por dia atingido. Tente amanhã.` });
  const [s] = await db.insert(leadSearches).values({ tenantId: tid, createdBy: req.auth!.userId, ...p.data }).returning();
  try { await iniciarBusca(s) } catch (e) { console.warn('[leads] iniciar', (e as Error).message) } // o acompanhamento tenta de novo
  res.status(201).json({ search: { ...s, jobId: undefined } });
});

leadsRouter.get('/:id', async (req, res) => {
  const s = await daEmpresa(req);
  if (!s) return res.status(404).json({ error: 'Busca não encontrada.' });
  const l = await db.select().from(leads).where(eq(leads.searchId, s.id)).orderBy(sql`${leads.mobile} desc, ${leads.phone} is null, ${leads.id}`);
  res.json({ search: { ...s, jobId: undefined }, leads: l });
});

leadsRouter.delete('/:id', async (req, res) => {
  const s = await daEmpresa(req);
  if (!s) return res.status(404).json({ error: 'Busca não encontrada.' });
  await db.delete(leadSearches).where(eq(leadSearches.id, s.id));
  res.json({ ok: true });
});

// salvar nos contatos (todos com telefone, só celulares ou os marcados), numa categoria
leadsRouter.post('/:id/import', async (req, res) => {
  const s = await daEmpresa(req);
  if (!s) return res.status(404).json({ error: 'Busca não encontrada.' });
  const p = z.object({
    leadIds: z.array(z.number().int()).optional(),
    somenteCelular: z.boolean().default(false),
    categoryId: z.number().int().nullable().optional(),
    newCategory: z.string().trim().max(60).optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Dados inválidos.' });
  const tid = tenantDe(req);
  let lista = await db.select().from(leads).where(p.data.leadIds?.length ? and(eq(leads.searchId, s.id), inArray(leads.id, p.data.leadIds)) : eq(leads.searchId, s.id));
  lista = lista.filter(l => l.phone && (!p.data.somenteCelular || l.mobile));
  if (!lista.length) return res.status(400).json({ error: 'Nenhum lead com telefone pra salvar.' });
  let categoryId = p.data.categoryId ?? null;
  if (p.data.newCategory) {
    const [c] = await db.insert(categories).values({ tenantId: tid, name: p.data.newCategory, color: '#F5A524' }).returning();
    categoryId = c.id;
  } else if (categoryId) {
    const [c] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.tenantId, tid)));
    if (!c) return res.status(400).json({ error: 'Categoria inválida.' });
  }
  try {
    const r = await importarLinhas(tid, lista.map(l => ({ name: l.name, phone: l.phone })), categoryId);
    await db.update(leads).set({ imported: true }).where(inArray(leads.id, lista.map(l => l.id)));
    res.json({ ...r, categoryId });
  } catch (e) { res.status(400).json({ error: (e as Error).message }) }
});

// planilha (abre no Excel)
leadsRouter.get('/:id/export', async (req, res) => {
  const s = await daEmpresa(req);
  if (!s) return res.status(404).json({ error: 'Busca não encontrada.' });
  const l = await db.select().from(leads).where(eq(leads.searchId, s.id)).orderBy(leads.id);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [['Nome', 'Telefone', 'Celular', 'Categoria', 'Endereço', 'Site', 'E-mails', 'Nota', 'Avaliações', 'Link no Google'].map(esc).join(';')]
    .concat(l.map(x => [x.name, x.phone || x.phoneRaw || '', x.mobile ? 'sim' : '', x.category, x.address, x.website, x.emails, x.rating || '', x.reviewCount ?? '', x.link].map(esc).join(';')));
  const nome = `${s.query}${s.location ? '-' + s.location : ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${nome}.csv"`);
  res.send('﻿' + linhas.join('\r\n'));
});
