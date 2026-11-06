import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { campaigns, connections, contacts, tenants, users } from '../db/schema.js';
import { exigirLogin, exigirSuperadmin } from '../lib/auth.js';

// Área do dono do SaaS: cria as empresas e o administrador de cada uma (não tem cadastro aberto).
export const adminRouter = Router();
adminRouter.use(exigirLogin, exigirSuperadmin);

adminRouter.get('/tenants', async (_req, res) => {
  const lista = await db.select({
    id: tenants.id, name: tenants.name, active: tenants.active, maxConnections: tenants.maxConnections, maxContacts: tenants.maxContacts, createdAt: tenants.createdAt,
    // nomes escritos por extenso: numa consulta de uma tabela só o Drizzle tira o prefixo da coluna,
    // e dentro da subconsulta "id" apontaria pra tabela errada
    users: sql<number>`(select count(*)::int from users u where u.tenant_id = "tenants"."id")`,
    connections: sql<number>`(select count(*)::int from connections c where c.tenant_id = "tenants"."id")`,
    contacts: sql<number>`(select count(*)::int from contacts c where c.tenant_id = "tenants"."id")`,
    campaigns: sql<number>`(select count(*)::int from campaigns c where c.tenant_id = "tenants"."id")`,
    adminEmail: sql<string | null>`(select u.email from users u where u.tenant_id = "tenants"."id" and u.role = 'admin' order by u.id limit 1)`,
  }).from(tenants).orderBy(tenants.id);
  res.json({ tenants: lista });
});

const empresaSchema = z.object({
  name: z.string().trim().min(2, 'Nome da empresa muito curto.'),
  maxConnections: z.coerce.number().int().min(1, 'Mínimo de 1 número.').max(50, 'Máximo de 50 números.').default(1),
  maxContacts: z.coerce.number().int().min(10, 'Mínimo de 10 contatos.').max(1_000_000, 'Máximo de 1 milhão de contatos.').default(5000),
});

adminRouter.post('/tenants', async (req, res) => {
  const p = empresaSchema.extend({
    adminName: z.string().trim().min(2, 'Informe o nome do administrador.'),
    adminEmail: z.string().trim().toLowerCase().email('E-mail do administrador inválido.'),
    adminPassword: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.'),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [ja] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.adminEmail));
  if (ja) return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
  const hash = await bcrypt.hash(p.data.adminPassword, 10);
  const t = await db.transaction(async tx => {
    const [t] = await tx.insert(tenants).values({ name: p.data.name, maxConnections: p.data.maxConnections, maxContacts: p.data.maxContacts }).returning();
    await tx.insert(users).values({ tenantId: t.id, name: p.data.adminName, email: p.data.adminEmail, passwordHash: hash, role: 'admin' });
    return t;
  });
  res.status(201).json({ tenant: t });
});

adminRouter.patch('/tenants/:id', async (req, res) => {
  const p = empresaSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [t] = await db.update(tenants).set(p.data).where(eq(tenants.id, Number(req.params.id))).returning();
  if (!t) return res.status(404).json({ error: 'Empresa não encontrada.' });
  // empresa desativada: campanhas em andamento param
  if (p.data.active === false) await db.update(campaigns).set({ status: 'paused', pauseReason: 'Empresa desativada.' }).where(and(eq(campaigns.tenantId, t.id), eq(campaigns.status, 'running')));
  res.json({ tenant: t });
});

adminRouter.delete('/tenants/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) return res.status(404).json({ error: 'Empresa não encontrada.' });
  if (t.active) return res.status(400).json({ error: 'Desative a empresa antes de excluir.' });
  await db.delete(tenants).where(eq(tenants.id, id));
  res.json({ ok: true });
});

// redefine a senha do administrador da empresa (cliente esqueceu)
adminRouter.post('/tenants/:id/reset-password', async (req, res) => {
  const p = z.object({ password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.') }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [u] = await db.select().from(users).where(and(eq(users.tenantId, Number(req.params.id)), eq(users.role, 'admin'))).orderBy(users.id).limit(1);
  if (!u) return res.status(404).json({ error: 'Essa empresa não tem administrador.' });
  await db.update(users).set({ passwordHash: await bcrypt.hash(p.data.password, 10), active: true }).where(eq(users.id, u.id));
  res.json({ ok: true, email: u.email });
});
