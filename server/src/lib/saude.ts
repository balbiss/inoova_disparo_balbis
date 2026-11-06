import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, connections } from '../db/schema.js';
import { astra, estadoDe } from './astra.js';
import { receberMensagem } from './conversas.js';

type Conexao = typeof connections.$inferSelect;
const EVENTOS = ['message', 'receipt', 'poll_vote', 'restriction', 'message_capping'];
const NOME_WEBHOOK = 'inoova-disparo';

/** URL pública da API (produção). Sem ela o AstraCalls não consegue avisar: usa a sincronização por histórico. */
export const urlPublica = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');

/** Garante o webhook desta conexão no AstraCalls (cria ou corrige a URL). */
export async function garantirWebhook(conn: Conexao) {
  if (!urlPublica()) return;
  let segredo = conn.webhookSecret;
  if (!segredo) {
    segredo = crypto.randomBytes(24).toString('hex');
    await db.update(connections).set({ webhookSecret: segredo }).where(eq(connections.id, conn.id));
  }
  const url = `${urlPublica()}/api/webhooks/astra/${conn.id}`;
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}/webhooks`;
  const { webhooks } = await astra<{ webhooks: { id: string; name: string; url: string }[] }>('GET', base, undefined, { timeoutMs: 15_000 });
  const meu = webhooks.find(w => w.name === NOME_WEBHOOK || w.url === url);
  const corpo = { name: NOME_WEBHOOK, url, secret: segredo, events: EVENTOS, ignoreGroups: true };
  if (!meu) await astra('POST', base, corpo, { timeoutMs: 15_000 });
  else if (meu.url !== url || conn.webhookSecret !== segredo) await astra('PUT', `${base}/${encodeURIComponent(meu.id)}`, corpo, { timeoutMs: 15_000 });
}

/** Confere a assinatura X-Webhook-Signature (sha256=<hex> do corpo com o segredo da conexão). */
export function assinaturaValida(segredo: string | null, corpo: Buffer, assinatura: string | undefined) {
  if (!segredo || !assinatura) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(assinatura.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Pausa as campanhas rodando nesse número (restrição / limite estourado). */
export async function pausarCampanhasDo(connId: number, motivo: string) {
  await db.update(campaigns).set({ status: 'paused', pauseReason: motivo }).where(and(eq(campaigns.connectionId, connId), eq(campaigns.status, 'running')));
}

const fmt = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export async function aplicarRestricao(conn: Conexao, r: { active?: boolean; ends_at?: number }) {
  const ativa = !!r?.active;
  const fim = r?.ends_at ? new Date(Number(r.ends_at)) : null;
  await db.update(connections).set({ restrictionActive: ativa, restrictionEndsAt: ativa ? fim : null, healthAt: new Date() }).where(eq(connections.id, conn.id));
  if (ativa && !conn.restrictionActive) {
    await pausarCampanhasDo(conn.id, `O WhatsApp aplicou uma restrição neste número${fim ? ' até ' + fmt(fim) : ''}: mensagens pra quem ainda não respondeu podem não chegar. Espere a restrição acabar pra retomar.`);
  }
}

export async function aplicarLimite(conn: Conexao, c: any) {
  if (!c) return;
  const status = String(c.capping_status || 'NONE');
  await db.update(connections).set({
    cappingStatus: c.unlimited ? 'UNLIMITED' : status,
    cappingRemaining: typeof c.remaining === 'number' ? c.remaining : null,
    cappingTotal: typeof c.total_quota === 'number' ? c.total_quota : null,
    healthAt: new Date(),
  }).where(eq(connections.id, conn.id));
  if (status === 'CAPPED' && conn.cappingStatus !== 'CAPPED') {
    await pausarCampanhasDo(conn.id, 'O número atingiu o limite de conversas novas do WhatsApp neste ciclo. Retome quando o limite renovar.');
  }
}

/** Consulta a saúde do número no AstraCalls. */
export async function atualizarSaude(conn: Conexao, forcar = false) {
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}`;
  try {
    const r = await astra<any>('GET', `${base}/restriction-status`, undefined, { timeoutMs: 15_000 });
    await aplicarRestricao(conn, r?.restriction || {});
  } catch { /* sem dado */ }
  try {
    const r = await astra<any>('GET', `${base}/capping${forcar ? '?refresh=1' : ''}`, undefined, { timeoutMs: 20_000 });
    if (r?.capping) await aplicarLimite(conn, r.capping);
  } catch { /* sem dado */ }
}

/** Sem URL pública (desenvolvimento): puxa as conversas recentes do histórico do AstraCalls. */
async function sincronizarHistorico(conn: Conexao) {
  const desde = conn.lastSyncAt ? conn.lastSyncAt.getTime() - 60_000 : Date.now() - 3600_000;
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}`;
  const chats = await astra<any[]>('GET', `${base}/chats?limit=40`, undefined, { timeoutMs: 20_000 });
  for (const c of chats || []) {
    if (c.type && c.type !== 'individual') continue;
    if (!c.timestamp || Number(c.timestamp) < desde) continue;
    const alias = String(c.id || '');
    const phone = alias.endsWith('@c.us') ? alias.split('@')[0] : String(c.chat || '').endsWith('@s.whatsapp.net') ? String(c.chat).split('@')[0] : '';
    if (!phone) continue;
    const msgs = await astra<any[]>('GET', `${base}/chats/${encodeURIComponent(c.chat)}/messages?limit=20&raw=true`, undefined, { timeoutMs: 20_000 });
    for (const m of (msgs || []).reverse()) {
      if (Number(m.timestamp) < desde) continue;
      await receberMensagem(conn, { id: m.id, chat: c.chat, chatPhone: phone, fromMe: m.fromMe, type: m.type, text: m.body, timestamp: m.timestamp, raw: m.raw });
    }
  }
  await db.update(connections).set({ lastSyncAt: new Date() }).where(eq(connections.id, conn.id));
}

let rodando = false;
/** Rotina: webhook garantido, saúde a cada 10 min e (só em dev) sincronização do histórico a cada 15 s. */
export function iniciarSaude() {
  let ciclo = 0;
  const passo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const todas = await db.select().from(connections);
      for (const conn of todas) {
        const st = await estadoDe(conn.sessionId);
        if (!st?.paired) continue;
        if (ciclo % 40 === 0) {
          await garantirWebhook(conn).catch(e => console.warn('[saude] webhook', conn.id, (e as Error).message));
          await atualizarSaude(conn);
        }
        if (!urlPublica()) await sincronizarHistorico(conn).catch(e => console.warn('[saude] sync', conn.id, (e as Error).message));
      }
    } catch (e) {
      console.warn('[saude]', (e as Error).message);
    } finally { rodando = false; ciclo++ }
  };
  setTimeout(passo, 5000);
  setInterval(passo, 15_000);
}
