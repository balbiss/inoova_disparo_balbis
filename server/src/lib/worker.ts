import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, contacts } from '../db/schema.js';
import { astra, AstraErro, estadoDe } from './astra.js';
import { base64DoUpload } from './uploads.js';
import { montarTexto } from './telefone.js';
import { conversaDe, gravarMensagem, ID_BOTAO_SAIR, TEXTO_BOTAO_SAIR } from './conversas.js';

// Motor dos disparos. A cada 2 s, cada campanha "running" cujo horário chegou dá UM passo:
//  - mensagem: envia pro próximo contato e agenda o próximo envio (intervalo sorteado entre min e max);
//  - ligação: liga pro próximo contato (broadcast de 1 número no AstraCalls), acompanha até terminar
//    e só então espera o intervalo e liga pro seguinte — assim dá pra pausar/cancelar a qualquer hora
//    e o número nunca faz duas ligações ao mesmo tempo.
// Um número (conexão) só atende uma campanha por vez; se cair ou levar restrição, a campanha pausa.
// Anti-bloqueio: rodízio entre versões do texto, {a|b} sorteado, "digitando…" antes de enviar,
// e quem pediu pra sair (descadastrado) é pulado mesmo que tenha entrado na lista antes.

type Campanha = typeof campaigns.$inferSelect;
type Alvo = typeof campaignTargets.$inferSelect;
type Conexao = typeof connections.$inferSelect;

const FINAIS_LIGACAO = new Set(['completed', 'no-answer', 'failed']);
const sorteio = (min: number, max: number) => Math.round((min + Math.random() * Math.max(0, max - min)) * 1000);
const depois = (ms: number) => new Date(Date.now() + ms);
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

let rodando = false;
const conexaoOcupada = new Set<number>();

export function iniciarWorker() {
  // envio interrompido no meio (servidor caiu): volta pra fila — o X-Message-ID guardado em
  // astra_ref garante que o reenvio não duplica no WhatsApp
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

async function proximo(c: Campanha, ms: number) {
  if (!(await concluirSeAcabou(c))) await db.update(campaigns).set({ nextAt: depois(ms) }).where(eq(campaigns.id, c.id));
}

async function passo(c: Campanha) {
  if (!c.connectionId) return pausar(c, 'A campanha está sem número de WhatsApp.');
  const [conn] = await db.select().from(connections).where(eq(connections.id, c.connectionId));
  if (!conn) return pausar(c, 'O número de WhatsApp desta campanha foi removido.');
  if (conexaoOcupada.has(conn.id)) return;
  conexaoOcupada.add(conn.id);
  try {
    if (c.kind === 'call') await passoLigacao(c, conn);
    else await passoMensagem(c, conn);
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

/** Número conectado e saudável? Senão pausa com o motivo. */
async function podeEnviar(c: Campanha, conn: Conexao) {
  const st = await estadoDe(conn.sessionId);
  if (!st?.paired) {
    await pausar(c, 'O número de WhatsApp está desconectado. Reconecte em Conexões e retome a campanha.');
    return false;
  }
  if (conn.restrictionActive && (!conn.restrictionEndsAt || conn.restrictionEndsAt > new Date())) {
    await pausar(c, 'O número está com restrição do WhatsApp. Espere a restrição acabar (veja em Conexões) pra retomar.');
    return false;
  }
  if (conn.cappingStatus === 'CAPPED') {
    await pausar(c, 'O número atingiu o limite de conversas novas do WhatsApp neste ciclo. Retome quando o limite renovar (veja em Conexões).');
    return false;
  }
  return true;
}

/** Pediu pra sair depois de entrar na lista? Pula (sem gastar intervalo). */
async function pularSeDescadastrado(c: Campanha, alvo: Alvo) {
  const [ct] = await db.select({ optOut: contacts.optOut }).from(contacts).where(and(eq(contacts.tenantId, c.tenantId), eq(contacts.phone, alvo.phone)));
  if (!ct?.optOut) return false;
  await db.update(campaignTargets).set({ status: 'skipped', error: 'Pediu pra não receber mais mensagens.', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  await proximo(c, 1000);
  return true;
}

/** Versão do texto pra este contato: rodízio entre o texto principal e as versões extras. */
export function versaoDoTexto(c: Pick<Campanha, 'text' | 'textVariants'>, alvoId: number) {
  const versoes = [c.text, ...(c.textVariants || [])].filter(v => v.trim());
  return versoes.length ? versoes[alvoId % versoes.length] : '';
}

// --- mensagem -----------------------------------------------------------------------------------
async function passoMensagem(c: Campanha, conn: Conexao) {
  const alvo = await proximoPendente(c);
  if (!alvo) { await concluirSeAcabou(c); return }
  if (await pularSeDescadastrado(c, alvo)) return;
  if (!(await podeEnviar(c, conn))) return;

  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages`;
  let msgId = alvo.astraRef;
  if (!msgId) {
    try { msgId = (await astra<{ id: string }>('GET', `${base}/new-message-id`, undefined, { timeoutMs: 15_000 })).id } catch { msgId = null }
    if (msgId) await db.update(campaignTargets).set({ astraRef: msgId }).where(eq(campaignTargets.id, alvo.id));
  }
  await db.update(campaignTargets).set({ status: 'sending' }).where(eq(campaignTargets.id, alvo.id));

  const texto = montarTexto(versaoDoTexto(c, alvo.id), alvo.name);
  const headers = msgId ? { 'X-Message-ID': msgId } : undefined;
  const tipo = c.messageType;
  try {
    if (c.typing) {
      // "digitando…" / "gravando áudio…" por alguns segundos, como uma pessoa
      await astra('POST', `${base}/typing`, { to: alvo.phone, typing: true, audio: tipo === 'audio' }, { timeoutMs: 10_000 }).catch(() => {});
      await espera(1500 + Math.random() * 2500);
    }
    let r: { id?: string } | null = null;
    const botoes = [...(c.buttons || []).map(b => ({
      type: b.type, displayText: b.text,
      ...(b.type === 'quick_reply' ? { id: b.value || b.text } : b.type === 'cta_url' ? { url: b.value } : b.type === 'cta_call' ? { phoneNumber: b.value } : { copyCode: b.value }),
    })), ...(c.optOutButton ? [{ type: 'quick_reply', displayText: TEXTO_BOTAO_SAIR, id: ID_BOTAO_SAIR }] : [])];

    if (tipo === 'text' && botoes.length) {
      r = await astra('POST', `${base}/interactive`, { to: alvo.phone, body: texto, footer: c.footer || undefined, buttons: botoes }, { headers });
    } else if (tipo === 'text') {
      r = await astra('POST', `${base}/text`, { to: alvo.phone, text: texto }, { headers });
    } else if (tipo === 'poll') {
      r = await astra('POST', `${base}/poll`, { to: alvo.phone, name: texto, options: c.pollOptions, multipleAnswers: c.pollMulti }, { headers });
    } else {
      if (!c.mediaPath) throw new AstraErro('Campanha sem arquivo de mídia.', 400);
      const corpo: Record<string, unknown> = { to: alvo.phone, base64: base64DoUpload(c.mediaPath), mimetype: c.mediaMime || undefined };
      if (tipo === 'audio') corpo.ptt = true;
      else if (texto.trim()) corpo.caption = texto;
      if (tipo === 'document') corpo.filename = c.mediaName || 'arquivo';
      r = await astra('POST', `${base}/${tipo}`, corpo, { headers, timeoutMs: 180_000 });
    }
    if (c.typing) astra('POST', `${base}/typing`, { to: alvo.phone, typing: false }, { timeoutMs: 10_000 }).catch(() => {});
    const waId = r?.id || msgId;
    await db.update(campaignTargets).set({ status: 'sent', error: null, doneAt: new Date(), astraRef: waId }).where(eq(campaignTargets.id, alvo.id));
    // aparece na aba Conversas (contexto quando a pessoa responder)
    const conv = await conversaDe(conn, alvo.phone, alvo.name);
    const rotulo = tipo === 'poll' ? `📊 ${texto}\n${c.pollOptions.map(o => '◯ ' + o).join('\n')}` : (tipo === 'audio' ? '' : texto) + (botoes.length ? '\n' + botoes.map(b => `[${b.displayText}]`).join(' ') : '');
    await gravarMensagem(conv, { waId, fromMe: true, type: tipo === 'poll' ? 'text' : tipo, text: rotulo, campaignId: c.id, mediaPath: c.mediaPath, mediaName: c.mediaName, mediaMime: c.mediaMime }).catch(() => {});
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) {
      // número caiu / AstraCalls fora: devolve o contato pra fila e pausa
      await db.update(campaignTargets).set({ status: 'pending' }).where(eq(campaignTargets.id, alvo.id));
      return pausar(c, err.status === 503 ? 'O número de WhatsApp desconectou. Reconecte em Conexões e retome a campanha.' : 'O servidor do WhatsApp não respondeu. Tente retomar em alguns minutos.');
    }
    await db.update(campaignTargets).set({ status: 'failed', error: err.message?.slice(0, 300) || 'erro', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  }
  await proximo(c, sorteio(c.minDelay, c.maxDelay));
}

// --- ligação ------------------------------------------------------------------------------------
const ROTULO_LIGACAO: Record<string, string> = { completed: 'atendeu', 'no-answer': 'não atendeu', failed: 'falhou' };

async function passoLigacao(c: Campanha, conn: Conexao) {
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}`;
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
        const seg = r.durationMs ? ` (${Math.round(r.durationMs / 1000)}s)` : '';
        const conv = await conversaDe(conn, emCurso.phone, emCurso.name);
        await gravarMensagem(conv, { waId: `call-${emCurso.astraRef}`, fromMe: true, type: 'call', text: `📞 Ligação da campanha "${c.name}": ${ROTULO_LIGACAO[status]}${seg}`, campaignId: c.id }).catch(() => {});
        await proximo(c, sorteio(c.minDelay, c.maxDelay));
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
  if (await pularSeDescadastrado(c, alvo)) return;
  if (!(await podeEnviar(c, conn))) return;
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
