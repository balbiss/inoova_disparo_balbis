import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { exigirAdminEmpresa, exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';

// Usuários da empresa (o administrador da empresa gerencia a equipe dele).
export const usersRouter = Router();
usersRouter.use(exigirLogin, exigirEmpresa, exigirAdminEmpresa);

const publico = (u: typeof users.$inferSelect) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, createdAt: u.createdAt });

usersRouter.get('/', async (req, res) => {
  const l = await db.select().from(users).where(eq(users.tenantId, tenantDe(req))).orderBy(users.id);
  res.json({ users: l.map(publico) });
});

usersRouter.post('/', async (req, res) => {
  const p = z.object({
    name: z.string().trim().min(2, 'Informe o nome.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.'),
    role: z.enum(['admin', 'user']).default('user'),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const [ja] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.email));
  if (ja) return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
  const [u] = await db.insert(users).values({ tenantId: tenantDe(req), name: p.data.name, email: p.data.email, role: p.data.role, passwordHash: await bcrypt.hash(p.data.password, 10) }).returning();
  res.status(201).json({ user: publico(u) });
});

usersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const p = z.object({
    name: z.string().trim().min(2).optional(),
    role: z.enum(['admin', 'user']).optional(),
    active: z.boolean().optional(),
    password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres.').optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  if (id === req.auth!.userId && (p.data.active === false || p.data.role === 'user')) return res.status(400).json({ error: 'Você não pode desativar nem rebaixar a si mesmo.' });
  const { password, ...resto } = p.data;
  const set: Partial<typeof users.$inferInsert> = { ...resto };
  if (password) set.passwordHash = await bcrypt.hash(password, 10);
  const [u] = await db.update(users).set(set).where(and(eq(users.id, id), eq(users.tenantId, tenantDe(req)))).returning();
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ user: publico(u) });
});

usersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.auth!.userId) return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' });
  const r = await db.delete(users).where(and(eq(users.id, id), eq(users.tenantId, tenantDe(req)))).returning({ id: users.id });
  if (!r.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ ok: true });
});
