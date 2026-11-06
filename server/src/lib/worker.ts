import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, contacts } from '../db/schema.js';
import { astra, AstraErro, estadoDe } from './astra.js';
import { base64DoUpload } from './uploads.js';
import { montarTexto } from './telefone.js';
import { conversaDe, gravarMensagem, ID_BOTAO_SAIR, mesmoTelefone, TEXTO_BOTAO_SAIR } from './conversas.js';
import {
  checarFalhasSeguidas, dentroDoHorario, efetiva, emConversa, liberarPausasVencidas, limitesNumero, registrarEnvio,
  textoProximaJanela, type Seguranca,
} from './seguranca.js';

// Motor dos disparos (mesmo modelo de segurança do InoovaCall — ver seguranca.ts):
//  - o NÚMERO é a unidade de segurança: 1 envio/ligação por vez, intervalo sorteado, pausa longa a cada
//    N envios, limite por hora/dia com aquecimento, pausa por restrição/limite do WhatsApp/falhas seguidas;
//  - RODÍZIO DE CHIPS: uma campanha pode ter vários números (connection_ids). Cada número, quando está livre,
//    RESERVA o próximo contato da fila (UPDATE … FOR UPDATE SKIP LOCKED) — dois números nunca pegam o mesmo;
//  - a campanha fica "enviando" e, quando não pode agir, guarda o motivo em wait_reason;
//  - antes de cada contato: descadastrado? em conversa com a equipe? tem WhatsApp? (pula sem gastar intervalo);
//  - mensagem: rodízio entre versões do texto, {a|b} sorteado, "digitando…" proporcional ao tamanho;
//  - grupos do WhatsApp como destino (is_group): sem checagens de contato, opção de marcar todos;
//  - ligação: toque sorteado; opcional "mensagem antes" e só liga depois de entregue/lida/respondida.

type Campanha = typeof campaigns.$inferSelect;
type Alvo = typeof campaignTargets.$inferSelect;
type Conexao = typeof connections.$inferSelect;

const FINAIS_LIGACAO = new Set(['completed', 'no-answer', 'failed']);
const EM_CURSO = ['pending', 'sending', 'warming', 'ringing', 'answered'];
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
const PRE_FILA_MAX = 12;       // ligações aguardando depois da mensagem antes (por número)
const PRE_VALIDADE_H = 24;     // sem cumprir a condição nesse tempo, desiste do contato

/** Números que enviam a campanha (rodízio) — sempre inclui o principal. */
export const numerosDa = (c: Pick<Campanha, 'connectionId' | 'connectionIds'>) => {
  const l = [...(c.connectionIds || [])];
  if (c.connectionId && !l.includes(c.connectionId)) l.unshift(c.connectionId);
  return l;
};

let rodando = false;

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
    await liberarPausasVencidas();
    // agendadas que chegaram na hora começam sozinhas
    await db.update(campaigns).set({ status: 'running', startedAt: sql`coalesce(${campaigns.startedAt}, now())`, scheduledAt: null })
      .where(and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, new Date())));
    const ativas = await db.select().from(campaigns).where(eq(campaigns.status, 'running')).orderBy(asc(campaigns.id));
    // por número: as campanhas dele (a mais antiga primeiro); números diferentes andam em paralelo
    const porNumero = new Map<number, Campanha[]>();
    for (const c of ativas) {
      const nums = numerosDa(c);
      if (!nums.length) { await pausar(c, 'A campanha está sem número de WhatsApp.'); continue }
      for (const n of nums) porNumero.set(n, [...(porNumero.get(n) || []), c]);
    }
    await Promise.all([...porNumero.entries()].map(([connId, lista]) => passoDoNumero(connId, lista).catch(e => console.error(`[worker] número ${connId}:`, (e as Error).message))));
  } catch (e) {
    console.error('[worker]', (e as Error).message);
  } finally {
    rodando = false;
  }
}

async function pausar(c: Campanha, motivo: string) {
  await db.update(campaigns).set({ status: 'paused', pauseReason: motivo, waitReason: null }).where(eq(campaigns.id, c.id));
}
async function aguardar(c: Campanha, motivo: string | null) {
  if (c.waitReason !== motivo) await db.update(campaigns).set({ waitReason: motivo }).where(eq(campaigns.id, c.id));
  c.waitReason = motivo;
}

async function concluirSeAcabou(c: Campanha) {
  const [{ n }] = await db.select({ n: count() }).from(campaignTargets).where(and(eq(campaignTargets.campaignId, c.id), inArray(campaignTargets.status, EM_CURSO)));
  if (n === 0) {
    await db.update(campaigns).set({ status: 'done', finishedAt: new Date(), nextAt: null, waitReason: null }).where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'running')));
    return true;
  }
  return false;
}

const fmtHora = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/** Motivo pelo qual este número não pode enviar agora (ou null). */
async function motivoDoNumero(conn: Conexao): Promise<string | null> {
  const st = await estadoDe(conn.sessionId);
  const agora = new Date();
  if (!st?.paired) return `O número "${conn.name}" está desconectado. Reconecte em Conexões que a campanha continua sozinha.`;
  if (conn.restrictionActive && (!conn.restrictionEndsAt || conn.restrictionEndsAt > agora)) return `O WhatsApp aplicou uma restrição no número "${conn.name}"${conn.restrictionEndsAt ? ' até ' + conn.restrictionEndsAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}. Continua quando acabar.`;
  if (conn.cappingStatus === 'CAPPED') return `O número "${conn.name}" atingiu o limite de conversas novas do WhatsApp neste ciclo. Continua quando renovar.`;
  if (conn.pausedUntil && conn.pausedUntil > agora) return conn.pauseReason || `Número "${conn.name}" em pausa de segurança até ${fmtHora(conn.pausedUntil)}.`;
  return null;
}

/** Um passo por número: acompanha ligação em curso ou faz o próximo envio da 1ª campanha que puder. */
async function passoDoNumero(connId: number, lista: Campanha[]) {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connId));
  if (!conn) {
    // número removido: campanha que só tinha ele pausa; com rodízio, os outros continuam
    for (const c of lista) if (numerosDa(c).length <= 1) await pausar(c, 'O número de WhatsApp desta campanha foi removido.');
    return;
  }

  // 1) ligação em andamento NESTE número? só acompanha (nada mais sai dele enquanto isso)
  for (const c of lista.filter(x => x.kind === 'call')) {
    if (await acompanharLigacao(c, conn)) return;
  }

  // 2) número pode agir agora? (com rodízio, só mostra o motivo se NENHUM número da campanha puder)
  const motivoNumero = await motivoDoNumero(conn);
  if (motivoNumero) {
    for (const c of lista) if (numerosDa(c).length <= 1) await aguardar(c, motivoNumero);
    return;
  }
  if (conn.nextAt && conn.nextAt > new Date()) return; // intervalo normal entre envios

  // 3) primeira campanha (mais antiga) que pode agir agora
  for (const c of lista) {
    const cfg = await efetiva(c.kind as 'message' | 'call', c.seguranca as Partial<Seguranca>);
    if (!dentroDoHorario(cfg)) { await aguardar(c, `Fora do horário de envio (${cfg.horarioInicio}–${cfg.horarioFim}); ${textoProximaJanela(cfg)}.`); continue }
    const l = await limitesNumero(conn, cfg);
    if (l.hora >= l.limiteHora) { if (numerosDa(c).length <= 1) await aguardar(c, `Limite de ${l.limiteHora} envios por hora deste número atingido; continua em alguns minutos.`); continue }
    if (l.dia >= l.limiteDia) {
      if (numerosDa(c).length <= 1) await aguardar(c, `Limite do dia deste número atingido (${l.limiteDia}${l.diaAquecimento ? `, aquecimento: dia ${l.diaAquecimento}` : ''}); ${textoProximaJanela(cfg) || 'volta amanhã'}.`);
      continue;
    }
    const agiu = c.kind === 'call' ? await passoLigacao(c, conn, cfg) : await passoMensagem(c, conn, cfg);
    if (agiu) { await aguardar(c, null); return }
  }
}

/** Reserva o próximo contato da fila pra ESTE número (seguro com vários números em paralelo). */
async function reservarProximo(c: Campanha, connId: number): Promise<Alvo | undefined> {
  const r = await db.execute(sql`
    update campaign_targets set status = 'sending', connection_id = ${connId}
     where id = (select id from campaign_targets where campaign_id = ${c.id} and status = 'pending' order by id limit 1 for update skip locked)
    returning id`) as unknown as { id: number }[];
  if (!r.length) return undefined;
  const [a] = await db.select().from(campaignTargets).where(eq(campaignTargets.id, Number(r[0].id)));
  return a;
}
async function devolver(alvo: Alvo) {
  await db.update(campaignTargets).set({ status: 'pending', connectionId: null }).where(eq(campaignTargets.id, alvo.id));
}
async function pular(alvo: Alvo, motivo: string) {
  await db.update(campaignTargets).set({ status: 'skipped', error: motivo, doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
}

/**
 * Checagens antes de falar com o contato. Devolve true se PULOU (o número fica livre quase na hora).
 * Também confere a restrição do WhatsApp na hora (como o InoovaCall) — se ativa, devolve 'restrito'.
 */
async function preChecagens(c: Campanha, conn: Conexao, cfg: Seguranca, alvo: Alvo): Promise<boolean | 'restrito'> {
  if (!alvo.isGroup) {
    const [ct] = await db.select().from(contacts).where(and(eq(contacts.tenantId, c.tenantId), mesmoTelefone(contacts.phone, alvo.phone))).limit(1);
    if (ct?.optOut) { await pular(alvo, 'Pediu pra não receber mais mensagens.'); return true }
    if (cfg.pularEmConversa && await emConversa(conn.id, alvo.phone)) { await pular(alvo, 'Em conversa com a equipe (últimos 3 dias).'); return true }
    if (cfg.verificarWhatsapp) {
      let status = ct?.waStatus ?? 'unknown';
      if (status === 'unknown') {
        try {
          const r = await astra<{ exists: boolean }>('GET', `/api/sessions/${encodeURIComponent(conn.sessionId)}/contacts/check?phone=${alvo.phone}`, undefined, { timeoutMs: 20_000 });
          status = r.exists ? 'valid' : 'invalid';
          if (ct) await db.update(contacts).set({ waStatus: status, waCheckedAt: new Date() }).where(eq(contacts.id, ct.id));
          await espera(rand(800, 2500)); // não encadeia consulta + envio "de robô"
        } catch { /* sem resposta: segue */ }
      }
      if (status === 'invalid') { await pular(alvo, 'Número sem WhatsApp.'); return true }
    }
  }
  try {
    const r = await astra<any>('GET', `/api/sessions/${encodeURIComponent(conn.sessionId)}/restriction-status`, undefined, { timeoutMs: 10_000 });
    if (r?.restriction?.active) {
      const ate = r.restriction.ends_at ? new Date(Number(r.restriction.ends_at)) : new Date(Date.now() + 6 * 3600_000);
      await db.update(connections).set({ restrictionActive: true, restrictionEndsAt: ate, healthAt: new Date() }).where(eq(connections.id, conn.id));
      return 'restrito';
    }
  } catch { /* endpoint indisponível não impede o envio */ }
  return false;
}

/** Versão do texto pra este contato: rodízio entre o texto principal e as versões extras. */
export function versaoDoTexto(c: Pick<Campanha, 'text' | 'textVariants'>, alvoId: number) {
  const versoes = [c.text, ...(c.textVariants || [])].filter(v => v.trim());
  return versoes.length ? versoes[alvoId % versoes.length] : '';
}

async function digitando(sessionId: string, to: string, texto: string, audio = false) {
  await astra('POST', `/api/sessions/${encodeURIComponent(sessionId)}/messages/typing`, { to, typing: true, audio }, { timeoutMs: 10_000 }).catch(() => {});
  await espera(Math.min(7000, 1200 + texto.length * 50 + Math.random() * 800));
}

type Conteudo = Pick<Campanha, 'messageType' | 'text' | 'textVariants' | 'buttons' | 'optOutButton' | 'footer' | 'pollOptions' | 'pollMulti' | 'mediaPath' | 'mediaMime' | 'mediaName' | 'typing' | 'mentionAll'>;

/**
 * Envia o conteúdo de uma campanha pra UM destino (contato ou grupo). Usado pelo motor e pelo
 * "Enviar teste pra mim". Devolve o id da mensagem no WhatsApp e o texto que ficou na conversa.
 */
export async function enviarConteudo(conn: Conexao, c: Conteudo, to: string, nome: string, opts: { versao?: number; msgId?: string | null; grupo?: boolean } = {}) {
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages`;
  const texto = montarTexto(versaoDoTexto(c, opts.versao ?? 0), nome);
  const headers = opts.msgId ? { 'X-Message-ID': opts.msgId } : undefined;
  const tipo = c.messageType;
  const marcarTodos = opts.grupo && c.mentionAll ? { mentionAll: true } : {};
  if (c.typing && !opts.grupo) await digitando(conn.sessionId, to, tipo === 'audio' ? 'x'.repeat(60) : texto, tipo === 'audio');
  const botoes = [...(c.buttons || []).map(b => ({
    type: b.type, displayText: b.text,
    ...(b.type === 'quick_reply' ? { id: b.value || b.text } : b.type === 'cta_url' ? { url: b.value } : b.type === 'cta_call' ? { phoneNumber: b.value } : { copyCode: b.value }),
  })), ...(c.optOutButton && !opts.grupo ? [{ type: 'quick_reply', displayText: TEXTO_BOTAO_SAIR, id: ID_BOTAO_SAIR }] : [])];

  let r: { id?: string } | null = null;
  if (tipo === 'text' && botoes.length) {
    r = await astra('POST', `${base}/interactive`, { to, body: texto, footer: c.footer || undefined, buttons: botoes }, { headers });
  } else if (tipo === 'text') {
    r = await astra('POST', `${base}/text`, { to, text: texto, ...marcarTodos }, { headers });
  } else if (tipo === 'poll') {
    r = await astra('POST', `${base}/poll`, { to, name: texto, options: c.pollOptions, multipleAnswers: c.pollMulti }, { headers });
  } else {
    if (!c.mediaPath) throw new AstraErro('Campanha sem arquivo de mídia.', 400);
    const corpo: Record<string, unknown> = { to, base64: base64DoUpload(c.mediaPath), mimetype: c.mediaMime || undefined, ...marcarTodos };
    if (tipo === 'audio') corpo.ptt = true;
    else if (texto.trim()) corpo.caption = texto;
    if (tipo === 'document') corpo.filename = c.mediaName || 'arquivo';
    r = await astra('POST', `${base}/${tipo}`, corpo, { headers, timeoutMs: 180_000 });
  }
  if (c.typing && !opts.grupo) astra('POST', `${base}/typing`, { to, typing: false }, { timeoutMs: 10_000 }).catch(() => {});
  const rotulo = tipo === 'poll' ? `📊 ${texto}\n${c.pollOptions.map(o => '◯ ' + o).join('\n')}` : (tipo === 'audio' ? '' : texto) + (botoes.length ? '\n' + botoes.map(b => `[${b.displayText}]`).join(' ') : '');
  return { waId: r?.id || opts.msgId || null, rotulo, tipo };
}

// --- mensagem -----------------------------------------------------------------------------------
async function passoMensagem(c: Campanha, conn: Conexao, cfg: Seguranca): Promise<boolean> {
  const alvo = await reservarProximo(c, conn.id);
  if (!alvo) { await concluirSeAcabou(c); return false }
  const pre = await preChecagens(c, conn, cfg, alvo);
  if (pre === 'restrito') { await devolver(alvo); return true }
  if (pre) { await registrarEnvio(conn, cfg, 0.1); await concluirSeAcabou(c); return true }

  let msgId = alvo.astraRef;
  if (!msgId) {
    try { msgId = (await astra<{ id: string }>('GET', `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages/new-message-id`, undefined, { timeoutMs: 15_000 })).id } catch { msgId = null }
    if (msgId) await db.update(campaignTargets).set({ astraRef: msgId }).where(eq(campaignTargets.id, alvo.id));
  }
  let falhou = false;
  try {
    const env = await enviarConteudo(conn, c, alvo.phone, alvo.name, { versao: alvo.id, msgId, grupo: alvo.isGroup });
    await db.update(campaignTargets).set({ status: 'sent', error: null, doneAt: new Date(), astraRef: env.waId }).where(eq(campaignTargets.id, alvo.id));
    if (!alvo.isGroup) {
      const conv = await conversaDe(conn, alvo.phone, alvo.name);
      await gravarMensagem(conv, { waId: env.waId, fromMe: true, type: env.tipo === 'poll' ? 'text' : env.tipo, text: env.rotulo, campaignId: c.id, mediaPath: c.mediaPath, mediaName: c.mediaName, mediaMime: c.mediaMime }).catch(() => {});
    }
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) {
      // número caiu / AstraCalls fora: devolve o contato pra fila (outro número do rodízio pode pegar); este espera 1 min
      await devolver(alvo);
      await db.update(connections).set({ nextAt: new Date(Date.now() + 60_000) }).where(eq(connections.id, conn.id));
      return true;
    }
    falhou = true;
    await db.update(campaignTargets).set({ status: 'failed', error: err.message?.slice(0, 300) || 'erro', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
  }
  await registrarEnvio(conn, cfg);
  if (falhou) await checarFalhasSeguidas(conn);
  await concluirSeAcabou(c);
  return true;
}

// --- ligação ------------------------------------------------------------------------------------
const ROTULO_LIGACAO: Record<string, string> = { completed: 'atendeu', 'no-answer': 'não atendeu', failed: 'falhou' };

/** Acompanha a ligação em curso da campanha NESTE número (se houver). Devolve true se o número está ocupado com ela. */
async function acompanharLigacao(c: Campanha, conn: Conexao): Promise<boolean> {
  const [emCurso] = await db.select().from(campaignTargets)
    .where(and(eq(campaignTargets.campaignId, c.id), inArray(campaignTargets.status, ['ringing', 'answered']), eq(campaignTargets.connectionId, conn.id))).limit(1);
  if (!emCurso) return false;
  if (c.nextAt && c.nextAt > new Date()) return true;
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}`;
  try {
    const st = await astra<any>('GET', `${base}/broadcast/${encodeURIComponent(emCurso.astraRef || '')}`, undefined, { timeoutMs: 15_000 });
    const r = (st.results || [])[0] || {};
    const status = String(r.status || 'queued');
    if (FINAIS_LIGACAO.has(status)) {
      await db.update(campaignTargets).set({ status, durationMs: r.durationMs ?? null, error: r.error || null, doneAt: new Date() }).where(eq(campaignTargets.id, emCurso.id));
      const seg = r.durationMs ? ` (${Math.round(r.durationMs / 1000)}s)` : '';
      const conv = await conversaDe(conn, emCurso.phone, emCurso.name);
      await gravarMensagem(conv, { waId: `call-${emCurso.astraRef}`, fromMe: true, type: 'call', text: `📞 Ligação da campanha "${c.name}": ${ROTULO_LIGACAO[status]}${seg}`, campaignId: c.id }).catch(() => {});
      const cfg = await efetiva('call', c.seguranca as Partial<Seguranca>);
      await registrarEnvio(conn, cfg);
      if (status === 'failed') await checarFalhasSeguidas(conn);
      await concluirSeAcabou(c);
      return true;
    }
    if (status === 'answered' && emCurso.status !== 'answered') await db.update(campaignTargets).set({ status: 'answered' }).where(eq(campaignTargets.id, emCurso.id));
  } catch (e) {
    if ((e as AstraErro).status === 404) {
      // o AstraCalls reiniciou e perdeu o acompanhamento dessa ligação
      await db.update(campaignTargets).set({ status: 'failed', error: 'Acompanhamento perdido (servidor de ligação reiniciou).', doneAt: new Date() }).where(eq(campaignTargets.id, emCurso.id));
      return false;
    }
  }
  await db.update(campaigns).set({ nextAt: new Date(Date.now() + 3000) }).where(eq(campaigns.id, c.id));
  return true;
}

/** Condição pra um contato que recebeu a "mensagem antes" já poder receber a ligação. */
function condicaoPronta(cfg: Seguranca) {
  switch (cfg.preCondicao) {
    case 'sempre': return sql`true`;
    case 'lida': return sql`(${campaignTargets.readAt} is not null or ${campaignTargets.repliedAt} is not null)`;
    case 'respondeu': return sql`${campaignTargets.repliedAt} is not null`;
    default: return sql`(${campaignTargets.deliveredAt} is not null or ${campaignTargets.readAt} is not null or ${campaignTargets.repliedAt} is not null)`;
  }
}

async function passoLigacao(c: Campanha, conn: Conexao, cfg: Seguranca): Promise<boolean> {
  if (!c.mediaPath) { await pausar(c, 'Campanha de ligação sem áudio/vídeo.'); return false }

  if (cfg.preMsgAtivo) {
    // quem recebeu a mensagem antes e não cumpriu a condição a tempo: desiste
    await db.update(campaignTargets).set({ status: 'skipped', error: `Não ${cfg.preCondicao === 'respondeu' ? 'respondeu' : cfg.preCondicao === 'lida' ? 'leu' : 'recebeu'} a mensagem antes em ${PRE_VALIDADE_H}h.`, doneAt: new Date() })
      .where(and(eq(campaignTargets.campaignId, c.id), eq(campaignTargets.status, 'warming'), lte(campaignTargets.preSentAt, new Date(Date.now() - PRE_VALIDADE_H * 3600_000))));
    // 1º) ligar pra quem já está pronto — sempre pelo MESMO número que mandou a mensagem
    const [pronto] = await db.select().from(campaignTargets)
      .where(and(eq(campaignTargets.campaignId, c.id), eq(campaignTargets.status, 'warming'), eq(campaignTargets.connectionId, conn.id), lte(campaignTargets.callAfter, new Date()), condicaoPronta(cfg)))
      .orderBy(asc(campaignTargets.callAfter)).limit(1);
    if (pronto) return ligar(c, conn, cfg, pronto);
    // 2º) senão, manda a mensagem antes pro próximo da fila (com teto de "aguardando" por número)
    const [{ aguardando }] = await db.select({ aguardando: count() }).from(campaignTargets)
      .where(and(eq(campaignTargets.campaignId, c.id), eq(campaignTargets.status, 'warming'), eq(campaignTargets.connectionId, conn.id)));
    if (aguardando < PRE_FILA_MAX) {
      const alvo = await reservarProximo(c, conn.id);
      if (alvo) return mensagemAntes(c, conn, cfg, alvo);
    }
    if (aguardando > 0) { await aguardar(c, 'Esperando os contatos receberem a mensagem antes de ligar.'); return false }
    await concluirSeAcabou(c);
    return false;
  }

  const alvo = await reservarProximo(c, conn.id);
  if (!alvo) { await concluirSeAcabou(c); return false }
  return ligar(c, conn, cfg, alvo, true);
}

async function mensagemAntes(c: Campanha, conn: Conexao, cfg: Seguranca, alvo: Alvo): Promise<boolean> {
  const pre = await preChecagens(c, conn, cfg, alvo);
  if (pre === 'restrito') { await devolver(alvo); return true }
  if (pre) { await registrarEnvio(conn, cfg, 0.1); return true }
  const texto = montarTexto(cfg.preMsgs[Math.floor(Math.random() * cfg.preMsgs.length)], alvo.name);
  try {
    await digitando(conn.sessionId, alvo.phone, texto);
    const r = await astra<{ id?: string }>('POST', `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages/text`, { to: alvo.phone, text: texto });
    const esp = rand(cfg.preEsperaMin, cfg.preEsperaMax) * 60_000;
    await db.update(campaignTargets).set({ status: 'warming', preMsgId: r?.id ?? `sem-id-${alvo.id}`, preSentAt: new Date(), callAfter: new Date(Date.now() + esp) }).where(eq(campaignTargets.id, alvo.id));
    const conv = await conversaDe(conn, alvo.phone, alvo.name);
    await gravarMensagem(conv, { waId: r?.id ?? null, fromMe: true, text: texto, campaignId: c.id }).catch(() => {});
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) { await devolver(alvo); await db.update(connections).set({ nextAt: new Date(Date.now() + 60_000) }).where(eq(connections.id, conn.id)); return true }
    await db.update(campaignTargets).set({ status: 'failed', error: 'mensagem antes: ' + (err.message?.slice(0, 280) || 'erro'), doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
    await checarFalhasSeguidas(conn);
  }
  await registrarEnvio(conn, cfg, 0.6); // mensagem pesa menos que ligação (igual InoovaCall)
  return true;
}

/** Dispara UMA ligação com a gravação da campanha (motor e "ligar teste pra mim"). */
export async function ligarCom(conn: Conexao, c: Pick<Campanha, 'mediaPath' | 'callVideo'>, phone: string, toqueMs: number) {
  return astra<{ campaignId: string }>('POST', `/api/sessions/${encodeURIComponent(conn.sessionId)}/broadcast`, {
    numbers: [phone], audio_base64: base64DoUpload(c.mediaPath!), video: c.callVideo, concurrency: 1, gap_ms: 0, max_ring_ms: toqueMs,
  }, { timeoutMs: 180_000 });
}

async function ligar(c: Campanha, conn: Conexao, cfg: Seguranca, alvo: Alvo, checar = false): Promise<boolean> {
  if (checar) {
    const pre = await preChecagens(c, conn, cfg, alvo);
    if (pre === 'restrito') { await devolver(alvo); return true }
    if (pre) { await registrarEnvio(conn, cfg, 0.1); await concluirSeAcabou(c); return true }
  } else {
    // contato que recebeu a mensagem antes: só confere descadastro (WhatsApp já foi checado)
    const [ct] = await db.select({ optOut: contacts.optOut }).from(contacts).where(and(eq(contacts.tenantId, c.tenantId), mesmoTelefone(contacts.phone, alvo.phone))).limit(1);
    if (ct?.optOut) { await pular(alvo, 'Pediu pra não receber mais mensagens.'); return true }
  }
  const toqueMs = Math.round(rand(cfg.toqueMin, cfg.toqueMax) * 1000);
  try {
    const r = await ligarCom(conn, c, alvo.phone, toqueMs);
    await db.update(campaignTargets).set({ status: 'ringing', astraRef: r.campaignId, connectionId: conn.id }).where(eq(campaignTargets.id, alvo.id));
    await db.update(campaigns).set({ nextAt: new Date(Date.now() + 3000) }).where(eq(campaigns.id, c.id));
  } catch (e) {
    const err = e as AstraErro;
    if (err.status === 503 || err.status === 502) { await devolver(alvo); await db.update(connections).set({ nextAt: new Date(Date.now() + 60_000) }).where(eq(connections.id, conn.id)); return true }
    await db.update(campaignTargets).set({ status: 'failed', error: err.message?.slice(0, 300) || 'erro', doneAt: new Date() }).where(eq(campaignTargets.id, alvo.id));
    await registrarEnvio(conn, cfg);
    await checarFalhasSeguidas(conn);
    await concluirSeAcabou(c);
  }
  return true;
}
