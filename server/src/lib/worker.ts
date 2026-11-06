import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections } from '../db/schema.js';
import { astra, AstraErro, estadoDe } from './astra.js';
import { base64DoUpload } from './uploads.js';
import { montarTexto } from './telefone.js';

// Motor dos disparos. A cada 2 s, cada campanha "running" cujo horário chegou dá UM passo:
//  - mensagem: envia pro próximo contato e agenda o próximo envio (intervalo sorteado entre min e max);
//  - ligação: liga pro próximo contato (broadcast de 1 número no AstraCalls), acompanha até terminar
//    e só então espera o intervalo e liga pro seguinte — assim dá pra pausar/cancelar a qualquer hora
//    e o número nunca faz duas ligações ao mesmo tempo.
// Um número (conexão) só atende uma campanha por vez; se cair, a campanha pausa com o motivo.

type Campanha = typeof campaigns.$inferSelect;
type Alvo = typeof campaignTargets.$inferSelect;

const FINAIS_LIGACAO = new Set(['completed', 'no-answer', 'failed']);
const sorteio = (min: number, max: number) => Math.round((min + Math.random() * Math.max(0, max - min)) * 1000);
const depois = (ms: number) => new Date(Date.now() + ms);

let rodando = false;
const conexaoOcupada = new Set<number>();

export function iniciarWorker() {
  // envio de mensagem interrompido no meio (servidor caiu): volta pra fila — o X-Message-ID
  // guardado em astra_ref garante que o reenvio não duplica no WhatsApp
  void db.update(campaignTargets).set({ status: 'pending' }).where(eq(campaignTargets.status, 'sending')).catch(() => {});
  setInterval(() => { void tick() }, 2000);
}

async function tick() {
  if (rodando) return;
  rodando = true;
  try {
    const prontas = await db.select().from(campaigns)
      .where(and(eq(campaigns.status, 'running'), or(isNull(campaigns.nextAt), lte(campaigns.nextAt, new Date()))));
    await Promise.all(prontas.map(c => passo(c).catch(e => console.error(`[worker] campanha ${c.id}:`, (e as Error).message))));
  } catch (e) {
    console.error('[worker]', (e as Error).message);
  } finally {
    rodando = false;
  }
}

async function pausar(c: Campanha, motivo: string) {
  await db.update(campaigns).set({ status: 'paused', pauseReason: motivo }).where(eq(campaigns.id, c.id));
}

async function concluirSeAcabou(c: Campanha) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campaignTargets)
    .where(and(eq(campaignTargets.campaignId, c.id), inArray(campaignTargets.status, ['pending', 'sending', 'ringing', 'answered'])));
  if (n === 0) {
    await db.update(campaigns).set({ status: 'done', finishedAt: new Date(), nextAt: null }).where(eq(campaigns.id, c.id));
    return true;
  }
  return false;
}

async function passo(c: Campanha) {
  if (!c.connectionId) return pausar(c, 'A campanha está sem número de WhatsApp.');
  const [conn] = await db.select().from(connections).where(eq(connections.id, c.connectionId));
  if (!conn) return pausar(c, 'O número de WhatsApp desta campanha foi removido.');
  if (conexaoOcupada.has(conn.id)) return;
  conexaoOcupada.add(conn.id);
  try {
    if (c.kind === 'call') await passoLigacao(c, conn.sessionId);
    else await passoMensagem(c, conn.sessionId);
  } finally {
    conexaoOcupada.delete(conn.id);
  }
}

async function proximoPendente(c: Campanha): Promise<Alvo | undefined> {
  const [a] = await db.select().from(campaignTargets)
    .where(and(eq(campaignTargets.campaignId, c.id), eq(campaignTargets.status, 'pending')))
    .orderBy(asc(campaignTargets.id)).limit(1);
  return a;
}

async function conectado(c: Campanha, sid: string) {
  const st = await estadoDe(sid);
  if (st?.paired) return true;
  await pausar(c, 'O número de WhatsApp está desconectado. Reconecte em Conexões e retome a campanha.');
  return false;
}

// --- mensagem -----------------------------------------------------------------------------------
async function passoMensagem(c: Campanha, sid: string) {
  const alvo = await proximoPendente(c);
  if (!alvo) { await concluirSeAcabou(c); return }
  if (!(await conectado(c, sid))) return;

  const base = `/api/sessions/${encodeURIComponent(sid)}`;
  let msgId = alvo.astraRef;
  if (!msgId) {
    try { msgId = (await astra<{ id: string }>('GET', `${base}/messages/new-message-id`, undefined, { timeoutMs: 15_000 })).id } catch { msgId = null }
    if (msgId) await db.update(campaignTargets).set({ astraRef: msgId }).where(eq(campaignTargets.id, alvo.id));
  }
  await db.update(campaignTargets).set({ status: 'sending' }).where(eq(campaignTargets.id, alvo.id));

  const texto = montarTexto(c.text, alvo.name);
  const headers = msgId ? { 'X-Message-ID': msgId } : undefined;
  try {
    if (c.messageType === 'text') {
      await astra('POST', `${base}/messages/text`, { to: alvo.phone, text: texto }, { headers });
    } else {
      if (!c.mediaPath) throw new AstraErro('Campanha sem arquivo de mídia.', 400);
      const corpo: Record<string, unknown> = { to: alvo.phone, base64: base64DoUpload(c.mediaPath), mimetype: c.mediaMime || undefined };
      if (c.messageType === 'audio') corpo.ptt = true;
      else if (texto.trim()) corpo.caption = texto;
      if (c.messageType === 'document') corpo.filename = c.mediaName || 'arquivo';
      await astra('POST', `${base}/messages/${c.messageType}`, corpo, { headers, timeoutMs: 180_000 });
    }
    await db.update(campaignTargets).set({ status: 'sent', error: null, doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) {
      // número caiu / AstraCalls fora: devolve o contato pra fila e pausa
      await db.update(campaignTargets).set({ status: 'pending' }).where(eq(campaignTargets.id, alvo.id));
      return pausar(c, err.status === 503 ? 'O número de WhatsApp desconectou. Reconecte em Conexões e retome a campanha.' : 'O servidor do WhatsApp não respondeu. Tente retomar em alguns minutos.');
    }
    await db.update(campaignTargets).set({ status: 'failed', error: err.message?.slice(0, 300) || 'erro', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  }
  if (!(await concluirSeAcabou(c))) {
    await db.update(campaigns).set({ nextAt: depois(sorteio(c.minDelay, c.maxDelay)) }).where(eq(campaigns.id, c.id));
  }
}

// --- ligação ------------------------------------------------------------------------------------
async function passoLigacao(c: Campanha, sid: string) {
  const base = `/api/sessions/${encodeURIComponent(sid)}`;
  const [emCurso] = await db.select().from(campaignTargets)
    .where(and(eq(campaignTargets.campaignId, c.id), inArray(campaignTargets.status, ['ringing', 'answered'])))
    .limit(1);

  if (emCurso) {
    // acompanha a ligação atual
    try {
      const st = await astra<any>('GET', `${base}/broadcast/${encodeURIComponent(emCurso.astraRef || '')}`, undefined, { timeoutMs: 15_000 });
      const r = (st.results || [])[0] || {};
      const status = String(r.status || 'queued');
      if (FINAIS_LIGACAO.has(status)) {
        await db.update(campaignTargets).set({ status, durationMs: r.durationMs ?? null, error: r.error || null, doneAt: new Date() }).where(eq(campaignTargets.id, emCurso.id));
        if (!(await concluirSeAcabou(c))) await db.update(campaigns).set({ nextAt: depois(sorteio(c.minDelay, c.maxDelay)) }).where(eq(campaigns.id, c.id));
        return;
      }
      if (status === 'answered' && emCurso.status !== 'answered') await db.update(campaignTargets).set({ status: 'answered' }).where(eq(campaignTargets.id, emCurso.id));
    } catch (e) {
      if ((e as AstraErro).status === 404) {
        // o AstraCalls reiniciou e perdeu o acompanhamento dessa ligação
        await db.update(campaignTargets).set({ status: 'failed', error: 'Acompanhamento perdido (servidor de ligação reiniciou).', doneAt: new Date() }).where(eq(campaignTargets.id, emCurso.id));
      }
    }
    await db.update(campaigns).set({ nextAt: depois(3000) }).where(eq(campaigns.id, c.id));
    return;
  }

  if (c.status !== 'running') return;
  const alvo = await proximoPendente(c);
  if (!alvo) { await concluirSeAcabou(c); return }
  if (!(await conectado(c, sid))) return;
  if (!c.mediaPath) return pausar(c, 'Campanha de ligação sem áudio/vídeo.');

  try {
    const r = await astra<{ campaignId: string }>('POST', `${base}/broadcast`, {
      numbers: [alvo.phone],
      audio_base64: base64DoUpload(c.mediaPath),
      video: c.callVideo,
      concurrency: 1,
      gap_ms: 0,
      max_ring_ms: c.maxRingSeconds * 1000,
    }, { timeoutMs: 180_000 });
    await db.update(campaignTargets).set({ status: 'ringing', astraRef: r.campaignId }).where(eq(campaignTargets.id, alvo.id));
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) return pausar(c, 'O número de WhatsApp desconectou ou o servidor de ligação não respondeu. Retome em seguida.');
    await db.update(campaignTargets).set({ status: 'failed', error: err.message?.slice(0, 300) || 'erro', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  }
  await db.update(campaigns).set({ nextAt: depois(3000) }).where(eq(campaigns.id, c.id));
}
