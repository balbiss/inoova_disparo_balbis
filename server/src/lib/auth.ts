import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, users } from '../db/schema.js';

const SEGREDO = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET não definida');
  return s;
};

export type Sessao = { userId: number; tenantId: number | null; role: 'superadmin' | 'admin' | 'user'; name: string; email: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { auth?: Sessao } }
}

export const assinar = (userId: number) => jwt.sign({ uid: userId }, SEGREDO(), { expiresIn: '30d' });

/** Exige login; recarrega o usuário a cada request (usuário/empresa desativados perdem acesso na hora). */
export async function exigirLogin(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Faça login.' });
  let uid: number;
  try { uid = (jwt.verify(token, SEGREDO()) as any).uid } catch { return res.status(401).json({ error: 'Sessão expirada, faça login de novo.' }) }
  const [u] = await db.select().from(users).where(eq(users.id, uid));
  if (!u || !u.active) return res.status(401).json({ error: 'Usuário desativado.' });
  if (u.tenantId) {
    const [t] = await db.select({ active: tenants.active }).from(tenants).where(eq(tenants.id, u.tenantId));
    if (!t?.active) return res.status(403).json({ error: 'Empresa desativada. Fale com o suporte.' });
  }
  req.auth = { userId: u.id, tenantId: u.tenantId, role: u.role as Sessao['role'], name: u.name, email: u.email };
  next();
}

export function exigirSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'superadmin') return res.status(403).json({ error: 'Só o administrador do sistema.' });
  next();
}

/** Rotas da empresa: precisa estar ligado a uma empresa. */
export function exigirEmpresa(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.tenantId) return res.status(403).json({ error: 'Esta área é das empresas.' });
  next();
}

export function exigirAdminEmpresa(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Só o administrador da empresa.' });
  next();
}

export const tenantDe = (req: Request) => req.auth!.tenantId as number;
