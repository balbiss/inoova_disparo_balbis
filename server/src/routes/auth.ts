import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { tenants, users } from '../db/schema.js';
import { assinar, exigirLogin } from '../lib/auth.js';

export const authRouter = Router();

async function perfil(userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  let empresa: { id: number; name: string; maxConnections: number; maxContacts: number } | null = null;
  if (u.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, u.tenantId));
    if (t) empresa = { id: t.id, name: t.name, maxConnections: t.maxConnections, maxContacts: t.maxContacts };
  }
  return { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId, empresa };
}

authRouter.post('/login', async (req, res) => {
  const p = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const [u] = await db.select().from(users).where(eq(users.email, p.data.email));
  if (!u || !(await bcrypt.compare(p.data.password, u.passwordHash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (!u.active) return res.status(403).json({ error: 'Usuário desativado.' });
  if (u.tenantId) {
    const [t] = await db.select({ active: tenants.active }).from(tenants).where(eq(tenants.id, u.tenantId));
    if (!t?.active) return res.status(403).json({ error: 'Empresa desativada. Fale com o suporte.' });
  }
  res.json({ token: assinar(u.id), user: await perfil(u.id) });
});

authRouter.get('/me', exigirLogin, async (req, res) => {
  res.json({ user: await perfil(req.auth!.userId) });
});

authRouter.post('/password', exigirLogin, async (req, res) => {
  const p = z.object({ current: z.string().min(1), password: z.string().min(6) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.userId));
  if (!u || !(await bcrypt.compare(p.data.current, u.passwordHash))) return res.status(400).json({ error: 'Senha atual incorreta.' });
  await db.update(users).set({ passwordHash: await bcrypt.hash(p.data.password, 10) }).where(eq(users.id, u.id));
  res.json({ ok: true });
});
