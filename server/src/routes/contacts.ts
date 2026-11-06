import { Router } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { categories, contacts, tenants } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { normalizarTelefone } from '../lib/telefone.js';
import { iniciarValidacao, pararValidacao, progressoDe } from '../lib/validacao.js';

export const contactsRouter = Router();
contactsRouter.use(exigirLogin, exigirEmpresa);

// --- categorias ---------------------------------------------------------------------------------
contactsRouter.get('/categories', async (req, res) => {
  const l = await db.select({
    id: categories.id, name: categories.name, color: categories.color,
    total: sql<number>`(select count(*)::int from contacts c where c.category_id = "categories"."id")`,
  }).from(categories).where(eq(categories.tenantId, tenantDe(req))).orderBy(asc(categories.name));
  res.json({ categories: l });
});

const catSchema = z.object({ name: z.string().trim().min(1, 'Dê um nome à categoria.').max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#128C7E') });

contactsRouter.post('/categories', async (req, res) => {
  const p = catSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [c] = await db.insert(categories).values({ ...p.data, tenantId: tenantDe(req) }).returning();
  res.status(201).json({ category: c });
});

contactsRouter.patch('/categories/:id', async (req, res) => {
  const p = catSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [c] = await db.update(categories).set(p.data).where(and(eq(categories.id, Number(req.params.id)), eq(categories.tenantId, tenantDe(req)))).returning();
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada.' });
  res.json({ category: c });
});

contactsRouter.delete('/categories/:id', async (req, res) => {
  await db.delete(categories).where(and(eq(categories.id, Number(req.params.id)), eq(categories.tenantId, tenantDe(req))));
  res.json({ ok: true });
});

// --- contatos -----------------------------------------------------------------------------------
/** Filtro comum da lista e da seleção de público: busca + categoria ('none' = sem categoria). */
export function filtroContatos(tenantId: number, q?: string, category?: string, situacao?: string): SQL {
  const conds: SQL[] = [eq(contacts.tenantId, tenantId)];
  const termo = (q || '').trim();
  if (termo) {
    const digitos = termo.replace(/\D/g, '');
    conds.push(or(ilike(contacts.name, `%${termo}%`), ...(digitos.length >= 3 ? [ilike(contacts.phone, `%${digitos}%`)] : []))!);
  }
  if (category === 'none') conds.push(isNull(contacts.categoryId));
  else if (category && /^\d+$/.test(category)) conds.push(eq(contacts.categoryId, Number(category)));
  // situação: descadastrados, sem WhatsApp, com WhatsApp, não validados
  if (situacao === 'optout') conds.push(eq(contacts.optOut, true));
  else if (situacao === 'invalid' || situacao === 'valid' || situacao === 'unknown') conds.push(eq(contacts.waStatus, situacao));
  return and(...conds)!;
}

contactsRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = Math.min(200, Math.max(10, Number(req.query.per) || 50));
  const where = filtroContatos(tenantDe(req), String(req.query.q || ''), String(req.query.category || ''), String(req.query.situacao || ''));
  const [{ total }] = await db.select({ total: count() }).from(contacts).where(where);
  const l = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, categoryId: contacts.categoryId, optOut: contacts.optOut, waStatus: contacts.waStatus, createdAt: contacts.createdAt })
    .from(contacts).where(where).orderBy(desc(contacts.id)).limit(per).offset((page - 1) * per);
  res.json({ contacts: l, total, page, per });
});

async function cabe(tenantId: number, novos: number) {
  const [t] = await db.select({ max: tenants.maxContacts }).from(tenants).where(eq(tenants.id, tenantId));
  const [{ n }] = await db.select({ n: count() }).from(contacts).where(eq(contacts.tenantId, tenantId));
  return { ok: n + novos <= t.max, max: t.max, atual: n };
}

async function categoriaValida(tenantId: number, id: number | null | undefined) {
  if (!id) return true;
  const [c] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, id), eq(categories.tenantId, tenantId)));
  return !!c;
}

const contatoSchema = z.object({ name: z.string().trim().max(120).default(''), phone: z.string(), categoryId: z.number().int().nullable().optional(), optOut: z.boolean().optional() });

contactsRouter.post('/', async (req, res) => {
  const p = contatoSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Dados inválidos.' });
  const phone = normalizarTelefone(p.data.phone);
  if (!phone) return res.status(400).json({ error: 'Telefone inválido. Use DDD + número.' });
  const tid = tenantDe(req);
  if (!(await categoriaValida(tid, p.data.categoryId))) return res.status(400).json({ error: 'Categoria inválida.' });
  const lim = await cabe(tid, 1);
  if (!lim.ok) return res.status(400).json({ error: `Seu plano permite até ${lim.max} contatos.` });
  const [c] = await db.insert(contacts).values({ tenantId: tid, name: p.data.name, phone, categoryId: p.data.categoryId ?? null }).onConflictDoNothing().returning();
  if (!c) return res.status(409).json({ error: 'Esse telefone já está nos seus contatos.' });
  res.status(201).json({ contact: c });
});

contactsRouter.patch('/:id', async (req, res) => {
  const p = contatoSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Dados inválidos.' });
  const tid = tenantDe(req);
  const set: Partial<typeof contacts.$inferInsert> = {};
  if (p.data.name !== undefined) set.name = p.data.name;
  if (p.data.phone !== undefined) {
    const phone = normalizarTelefone(p.data.phone);
    if (!phone) return res.status(400).json({ error: 'Telefone inválido. Use DDD + número.' });
    set.phone = phone;
  }
  if (p.data.categoryId !== undefined) {
    if (!(await categoriaValida(tid, p.data.categoryId))) return res.status(400).json({ error: 'Categoria inválida.' });
    set.categoryId = p.data.categoryId;
  }
  if (p.data.optOut !== undefined) { set.optOut = p.data.optOut; set.optOutAt = p.data.optOut ? new Date() : null }
  if (set.phone) { set.waStatus = 'unknown'; set.waCheckedAt = null }
  try {
    const [c] = await db.update(contacts).set(set).where(and(eq(contacts.id, Number(req.params.id)), eq(contacts.tenantId, tid))).returning();
    if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ contact: c });
  } catch {
    res.status(409).json({ error: 'Esse telefone já está em outro contato.' });
  }
});

// excluir vários (ids) ou todos do filtro atual (all=true + q/category)
contactsRouter.post('/delete', async (req, res) => {
  const tid = tenantDe(req);
  const b = req.body || {};
  let r;
  if (b.all === true) r = await db.delete(contacts).where(filtroContatos(tid, b.q, b.category, b.situacao)).returning({ id: contacts.id });
  else {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length) return res.status(400).json({ error: 'Nenhum contato selecionado.' });
    r = await db.delete(contacts).where(and(eq(contacts.tenantId, tid), inArray(contacts.id, ids))).returning({ id: contacts.id });
  }
  res.json({ deleted: r.length });
});

// importação: a planilha é lida no navegador e chega aqui como linhas {name, phone}
contactsRouter.post('/import', async (req, res) => {
  const p = z.object({
    rows: z.array(z.object({ name: z.any().optional(), phone: z.any() })).max(50_000),
    categoryId: z.number().int().nullable().optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Planilha inválida.' });
  const tid = tenantDe(req);
  if (!(await categoriaValida(tid, p.data.categoryId))) return res.status(400).json({ error: 'Categoria inválida.' });

  const vistos = new Set<string>();
  const validos: { name: string; phone: string }[] = [];
  let invalidos = 0;
  for (const r of p.data.rows) {
    const phone = normalizarTelefone(r.phone);
    if (!phone) { invalidos++; continue }
    if (vistos.has(phone)) continue;
    vistos.add(phone);
    validos.push({ name: String(r.name ?? '').trim().slice(0, 120), phone });
  }
  // quem já existe só ganha nome/categoria (não conta no limite)
  const existentes = new Set<string>();
  for (let i = 0; i < validos.length; i += 1000) {
    const fatia = validos.slice(i, i + 1000).map(v => v.phone);
    const ja = await db.select({ phone: contacts.phone }).from(contacts).where(and(eq(contacts.tenantId, tid), inArray(contacts.phone, fatia)));
    ja.forEach(j => existentes.add(j.phone));
  }
  const novos = validos.filter(v => !existentes.has(v.phone));
  const lim = await cabe(tid, novos.length);
  if (!lim.ok) return res.status(400).json({ error: `Essa planilha tem ${novos.length} contatos novos e seu plano permite ${lim.max} (você já tem ${lim.atual}).` });

  for (let i = 0; i < validos.length; i += 500) {
    const fatia = validos.slice(i, i + 500).map(v => ({ tenantId: tid, name: v.name, phone: v.phone, categoryId: p.data.categoryId ?? null }));
    await db.insert(contacts).values(fatia).onConflictDoUpdate({
      target: [contacts.tenantId, contacts.phone],
      set: {
        name: sql`case when excluded.name <> '' then excluded.name else ${contacts.name} end`,
        categoryId: sql`coalesce(excluded.category_id, ${contacts.categoryId})`,
      },
    });
  }
  res.json({ created: novos.length, updated: validos.length - novos.length, invalid: invalidos, duplicatedInFile: p.data.rows.length - invalidos - validos.length });
});

// --- validação no WhatsApp ----------------------------------------------------------------------
contactsRouter.post('/validate', async (req, res) => {
  const b = req.body || {};
  try {
    const p = await iniciarValidacao(tenantDe(req), filtroContatos(tenantDe(req), b.q, b.category, b.situacao), !!b.refazer);
    res.json({ progress: p });
  } catch (e) { res.status(400).json({ error: (e as Error).message }) }
});
contactsRouter.get('/validate', (req, res) => { res.json({ progress: progressoDe(tenantDe(req)) }) });
contactsRouter.post('/validate/stop', (req, res) => { pararValidacao(tenantDe(req)); res.json({ ok: true }) });

// resumo pra tela: quantos descadastrados / sem WhatsApp / não validados
contactsRouter.get('/summary', async (req, res) => {
  const [r] = await db.select({
    total: sql<number>`count(*)::int`,
    optOut: sql<number>`count(*) filter (where ${contacts.optOut})::int`,
    invalid: sql<number>`count(*) filter (where ${contacts.waStatus} = 'invalid')::int`,
    valid: sql<number>`count(*) filter (where ${contacts.waStatus} = 'valid')::int`,
    unknown: sql<number>`count(*) filter (where ${contacts.waStatus} = 'unknown')::int`,
  }).from(contacts).where(eq(contacts.tenantId, tenantDe(req)));
  res.json(r);
});
