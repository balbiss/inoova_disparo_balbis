import { and, asc, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connections, contacts } from '../db/schema.js';
import { astra, AstraErro, estadoDe } from './astra.js';

// Validação da lista no WhatsApp (contacts/check do AstraCalls), em segundo plano e devagar
// (1 consulta a cada ~1,2 s) pra não chamar atenção do WhatsApp. Um trabalho por empresa.
export type Progresso = { total: number; feitos: number; validos: number; invalidos: number; rodando: boolean; erro?: string; inicio: number };
const trabalhos = new Map<number, Progresso>();
export const progressoDe = (tenantId: number) => trabalhos.get(tenantId) ?? null;

export async function iniciarValidacao(tenantId: number, filtro: SQL, refazer: boolean) {
  const atual = trabalhos.get(tenantId);
  if (atual?.rodando) throw new Error('Já existe uma validação em andamento.');
  const conns = await db.select().from(connections).where(eq(connections.tenantId, tenantId));
  let sessao: string | null = null;
  for (const c of conns) if ((await estadoDe(c.sessionId))?.paired) { sessao = c.sessionId; break }
  if (!sessao) throw new Error('Conecte um número de WhatsApp pra validar a lista.');

  const where = refazer ? filtro : and(filtro, eq(contacts.waStatus, 'unknown'))!;
  const lista = await db.select({ id: contacts.id }).from(contacts).where(where).orderBy(asc(contacts.id));
  const p: Progresso = { total: lista.length, feitos: 0, validos: 0, invalidos: 0, rodando: true, inicio: Date.now() };
  trabalhos.set(tenantId, p);

  void (async () => {
    for (const { id } of lista) {
      if (!p.rodando) break;
      const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
      if (!c) { p.feitos++; continue }
      try {
        const r = await astra<{ exists: boolean }>('GET', `/api/sessions/${encodeURIComponent(sessao!)}/contacts/check?phone=${c.phone}`, undefined, { timeoutMs: 20_000 });
        const ok = !!r.exists;
        await db.update(contacts).set({ waStatus: ok ? 'valid' : 'invalid', waCheckedAt: new Date() }).where(eq(contacts.id, c.id));
        ok ? p.validos++ : p.invalidos++;
      } catch (e) {
        if ((e as AstraErro).status === 503 || (e as AstraErro).status === 502) { p.erro = 'O número de WhatsApp desconectou durante a validação.'; break }
      }
      p.feitos++;
      await new Promise(r => setTimeout(r, 900 + Math.random() * 700));
    }
    p.rodando = false;
  })();
  return p;
}

export function pararValidacao(tenantId: number) {
  const p = trabalhos.get(tenantId);
  if (p) p.rodando = false;
}
