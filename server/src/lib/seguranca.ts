import { and, eq, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, settings } from '../db/schema.js';

// Segurança anti-bloqueio, no mesmo modelo do InoovaCall:
//  - intervalo ALEATÓRIO entre envios do MESMO número (vale pra todas as campanhas dele);
//  - pausa longa a cada N envios (N sorteado), de X minutos (sorteado);
//  - limite por hora e por dia por número, com aquecimento de número novo (limite cresce por dia);
//  - janela de horário (horário de Brasília) e dias da semana;
//  - verifica se o contato tem WhatsApp antes de enviar; pula quem está em conversa com a equipe;
//  - restrição do WhatsApp ou N falhas seguidas → pausa o NÚMERO (a campanha retoma sozinha depois);
//  - ligação: tempo de toque sorteado e, opcional, mensagem antes (só liga se entregue/lida/respondida).
// O superadmin define o PADRÃO e os LIMITES (piso do intervalo, teto do dia); o cliente ajusta por
// campanha, mas nunca abaixo do piso nem acima do teto.

export type Seguranca = {
  intervaloMin: number; intervaloMax: number;          // segundos entre envios do mesmo número
  pausaCadaMin: number; pausaCadaMax: number;          // a cada N envios (sorteado)…
  pausaMin: number; pausaMax: number;                  // …pausa de X minutos (sorteado)
  limiteHora: number; limiteDia: number;               // por número
  horarioInicio: string; horarioFim: string;           // HH:MM (Brasília)
  diasSemana: number[];                                // 0=dom … 6=sáb
  verificarWhatsapp: boolean;
  pularEmConversa: boolean;                            // pula quem conversou com a equipe nos últimos 3 dias
  aquecimento: boolean;                                // número novo: limite do dia começa baixo e cresce
  toqueMin: number; toqueMax: number;                  // ligação: segundos tocando (sorteado)
  // ligação: mensagem antes
  preMsgAtivo: boolean; preMsgs: string[]; preEsperaMin: number; preEsperaMax: number;
  preCondicao: 'sempre' | 'entregue' | 'lida' | 'respondeu';
};

export type SegurancaAdmin = Seguranca & {
  pisoIntervaloMsg: number; pisoIntervaloLigacao: number; // cliente não configura menos que isso
  tetoDia: number;                                        // cliente não passa disso
  aquecimentoDia1: number; aquecimentoIncremento: number;
  falhasSeguidas: number; pausaFalhasMin: number;         // N falhas seguidas → pausa o número
  // padrões de ligação (mais espaçados que mensagem)
  ligIntervaloMin: number; ligIntervaloMax: number; ligLimiteHora: number; ligLimiteDia: number;
};

export const PADRAO_ADMIN: SegurancaAdmin = {
  intervaloMin: 20, intervaloMax: 60,
  pausaCadaMin: 12, pausaCadaMax: 22, pausaMin: 4, pausaMax: 12,
  limiteHora: 60, limiteDia: 300,
  horarioInicio: '09:00', horarioFim: '20:00', diasSemana: [1, 2, 3, 4, 5, 6],
  verificarWhatsapp: true, pularEmConversa: true, aquecimento: true,
  toqueMin: 28, toqueMax: 42,
  preMsgAtivo: false, preMsgs: [], preEsperaMin: 3, preEsperaMax: 10, preCondicao: 'entregue',
  pisoIntervaloMsg: 8, pisoIntervaloLigacao: 15, tetoDia: 600,
  aquecimentoDia1: 25, aquecimentoIncremento: 25,
  falhasSeguidas: 6, pausaFalhasMin: 30,
  ligIntervaloMin: 25, ligIntervaloMax: 75, ligLimiteHora: 35, ligLimiteDia: 180,
};

let cache: { v: SegurancaAdmin; at: number } | null = null;
export async function lerAdmin(): Promise<SegurancaAdmin> {
  if (cache && Date.now() - cache.at < 30_000) return cache.v;
  const [r] = await db.select().from(settings).where(eq(settings.key, 'antiban'));
  const v = { ...PADRAO_ADMIN, ...(r?.value as Partial<SegurancaAdmin> | undefined) };
  cache = { v, at: Date.now() };
  return v;
}
export async function salvarAdmin(v: Partial<SegurancaAdmin>) {
  const atual = await lerAdmin();
  const novo = { ...atual, ...v };
  await db.insert(settings).values({ key: 'antiban', value: novo }).onConflictDoUpdate({ target: settings.key, set: { value: novo, updatedAt: new Date() } });
  cache = null;
  return novo;
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const hhmm = (v: unknown, d: string) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : d);

/** Padrão que a tela de nova campanha mostra (mensagem ou ligação). */
export async function padraoCampanha(kind: 'message' | 'call'): Promise<Seguranca> {
  const a = await lerAdmin();
  const base: Seguranca = {
    intervaloMin: a.intervaloMin, intervaloMax: a.intervaloMax, pausaCadaMin: a.pausaCadaMin, pausaCadaMax: a.pausaCadaMax,
    pausaMin: a.pausaMin, pausaMax: a.pausaMax, limiteHora: a.limiteHora, limiteDia: a.limiteDia,
    horarioInicio: a.horarioInicio, horarioFim: a.horarioFim, diasSemana: a.diasSemana,
    verificarWhatsapp: a.verificarWhatsapp, pularEmConversa: a.pularEmConversa, aquecimento: a.aquecimento,
    toqueMin: a.toqueMin, toqueMax: a.toqueMax,
    preMsgAtivo: false, preMsgs: [], preEsperaMin: a.preEsperaMin, preEsperaMax: a.preEsperaMax, preCondicao: a.preCondicao,
  };
  if (kind === 'call') Object.assign(base, { intervaloMin: a.ligIntervaloMin, intervaloMax: a.ligIntervaloMax, limiteHora: a.ligLimiteHora, limiteDia: a.ligLimiteDia });
  return base;
}

/** Junta o que a campanha pediu com o padrão, respeitando piso e teto do admin. */
export async function efetiva(kind: 'message' | 'call', pedido: Partial<Seguranca> = {}): Promise<Seguranca> {
  const a = await lerAdmin();
  const p = await padraoCampanha(kind);
  const piso = kind === 'call' ? a.pisoIntervaloLigacao : a.pisoIntervaloMsg;
  const c: Seguranca = { ...p };
  c.intervaloMin = Math.max(piso, num(pedido.intervaloMin, p.intervaloMin));
  c.intervaloMax = Math.max(c.intervaloMin, num(pedido.intervaloMax, p.intervaloMax));
  c.pausaCadaMin = Math.max(3, num(pedido.pausaCadaMin, p.pausaCadaMin));
  c.pausaCadaMax = Math.max(c.pausaCadaMin, num(pedido.pausaCadaMax, p.pausaCadaMax));
  c.pausaMin = Math.max(1, num(pedido.pausaMin, p.pausaMin));
  c.pausaMax = Math.max(c.pausaMin, num(pedido.pausaMax, p.pausaMax));
  c.limiteHora = Math.max(1, num(pedido.limiteHora, p.limiteHora));
  c.limiteDia = Math.min(a.tetoDia, Math.max(1, num(pedido.limiteDia, p.limiteDia)));
  c.horarioInicio = hhmm(pedido.horarioInicio, p.horarioInicio);
  c.horarioFim = hhmm(pedido.horarioFim, p.horarioFim);
  c.diasSemana = Array.isArray(pedido.diasSemana) && pedido.diasSemana.length ? pedido.diasSemana.map(Number).filter(d => d >= 0 && d <= 6) : p.diasSemana;
  c.verificarWhatsapp = pedido.verificarWhatsapp ?? p.verificarWhatsapp;
  c.pularEmConversa = pedido.pularEmConversa ?? p.pularEmConversa;
  c.aquecimento = pedido.aquecimento ?? p.aquecimento;
  c.toqueMin = Math.min(60, Math.max(15, num(pedido.toqueMin, p.toqueMin)));
  c.toqueMax = Math.min(60, Math.max(c.toqueMin, num(pedido.toqueMax, p.toqueMax)));
  c.preMsgs = (Array.isArray(pedido.preMsgs) ? pedido.preMsgs : []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 5);
  c.preMsgAtivo = kind === 'call' && !!pedido.preMsgAtivo && c.preMsgs.length > 0;
  c.preEsperaMin = Math.max(1, num(pedido.preEsperaMin, p.preEsperaMin));
  c.preEsperaMax = Math.max(c.preEsperaMin, num(pedido.preEsperaMax, p.preEsperaMax));
  c.preCondicao = (['sempre', 'entregue', 'lida', 'respondeu'] as const).includes(pedido.preCondicao as never) ? pedido.preCondicao! : p.preCondicao;
  return c;
}

// --- horário (Brasília) -------------------------------------------------------------------------
const TZ = 'America/Sao_Paulo';
function agoraSP() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[get('weekday')] ?? 0, minutos: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}
const hm = (s: string) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) };

export function dentroDoHorario(c: Pick<Seguranca, 'horarioInicio' | 'horarioFim' | 'diasSemana'>) {
  const { dia, minutos } = agoraSP();
  if (c.diasSemana.length && !c.diasSemana.includes(dia)) return false;
  const ini = hm(c.horarioInicio), fim = hm(c.horarioFim);
  return ini <= fim ? minutos >= ini && minutos < fim : minutos >= ini || minutos < fim;
}

const NOME_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "volta hoje às 09:00" / "volta amanhã às 09:00" / "volta segunda às 09:00". */
export function textoProximaJanela(c: Pick<Seguranca, 'horarioInicio' | 'horarioFim' | 'diasSemana'>) {
  const { dia, minutos } = agoraSP();
  const ini = hm(c.horarioInicio);
  const dias = c.diasSemana.length ? c.diasSemana : [0, 1, 2, 3, 4, 5, 6];
  for (let d = 0; d < 8; d++) {
    const wd = (dia + d) % 7;
    if (!dias.includes(wd)) continue;
    if (d === 0 && minutos >= ini) continue;
    return `volta ${d === 0 ? 'hoje' : d === 1 ? 'amanhã' : NOME_DIA[wd]} às ${c.horarioInicio}`;
  }
  return '';
}

// --- limites do número --------------------------------------------------------------------------
type Conexao = typeof connections.$inferSelect;
const NAO_CONTA = ['pending', 'skipped'];

/** Envios do número na última hora e hoje (Brasília), e os limites que valem agora (com aquecimento). */
export async function limitesNumero(conn: Pick<Conexao, 'id' | 'warmupSince'>, cfg: Pick<Seguranca, 'limiteHora' | 'limiteDia' | 'aquecimento'>) {
  const a = await lerAdmin();
  const umaHora = new Date(Date.now() - 3600_000);
  const inicioDia = sql`(date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`;
  const doNumero = and(eq(campaigns.connectionId, conn.id), notInArray(campaignTargets.status, NAO_CONTA));
  const [r] = await db.select({
    hora: sql<number>`count(*) filter (where ${campaignTargets.doneAt} >= ${umaHora.toISOString()}::timestamptz or ${campaignTargets.preSentAt} >= ${umaHora.toISOString()}::timestamptz)::int`,
    dia: sql<number>`count(*) filter (where ${campaignTargets.doneAt} >= ${inicioDia} or ${campaignTargets.preSentAt} >= ${inicioDia})::int`,
  }).from(campaignTargets).innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId)).where(doNumero);
  let limiteDia = Math.min(cfg.limiteDia, a.tetoDia);
  let diaAquecimento: number | null = null;
  if (cfg.aquecimento) {
    diaAquecimento = Math.floor((Date.now() - new Date(conn.warmupSince).getTime()) / 86_400_000) + 1;
    limiteDia = Math.min(limiteDia, a.aquecimentoDia1 + a.aquecimentoIncremento * (diaAquecimento - 1));
  }
  return { hora: r?.hora ?? 0, dia: r?.dia ?? 0, limiteHora: cfg.limiteHora, limiteDia, diaAquecimento };
}

const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const fmtHora = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/**
 * Depois de cada envio/ligação: agenda o próximo do número (intervalo sorteado; `fator` < 1 pra
 * ações leves como pular contato) e, a cada N envios, aplica a pausa longa sorteada.
 */
export async function registrarEnvio(conn: Conexao, cfg: Seguranca, fator = 1) {
  const espera = rand(cfg.intervaloMin, cfg.intervaloMax) * 1000 * fator;
  const enviados = conn.sendsSincePause + (fator >= 0.5 ? 1 : 0);
  const alvo = conn.pauseEvery ?? randInt(cfg.pausaCadaMin, cfg.pausaCadaMax);
  if (enviados >= alvo) {
    const min = rand(cfg.pausaMin, cfg.pausaMax);
    const ate = new Date(Date.now() + min * 60_000);
    await db.update(connections).set({ sendsSincePause: 0, pauseEvery: randInt(cfg.pausaCadaMin, cfg.pausaCadaMax), pausedUntil: ate, pauseReason: `Pausa de segurança (${enviados} envios seguidos) até ${fmtHora(ate)}`, nextAt: ate }).where(eq(connections.id, conn.id));
    return;
  }
  await db.update(connections).set({ sendsSincePause: enviados, pauseEvery: alvo, nextAt: new Date(Date.now() + espera) }).where(eq(connections.id, conn.id));
}

/** N falhas seguidas no número = sinal de bloqueio → pausa o número. */
export async function checarFalhasSeguidas(conn: Conexao) {
  const a = await lerAdmin();
  if (a.falhasSeguidas <= 0) return;
  const ult = await db.select({ status: campaignTargets.status }).from(campaignTargets).innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(and(eq(campaigns.connectionId, conn.id), isNotNull(campaignTargets.doneAt), ne(campaignTargets.status, 'skipped')))
    .orderBy(sql`${campaignTargets.doneAt} desc`).limit(a.falhasSeguidas);
  if (ult.length >= a.falhasSeguidas && ult.every(u => u.status === 'failed')) {
    const ate = new Date(Date.now() + a.pausaFalhasMin * 60_000);
    await db.update(connections).set({ pausedUntil: ate, pauseReason: `${a.falhasSeguidas} falhas seguidas (possível bloqueio): número em pausa até ${fmtHora(ate)}`, nextAt: ate }).where(eq(connections.id, conn.id));
  }
}

/** A equipe conversou com esse telefone nos últimos 3 dias (pela tela ou pelo celular)? */
export async function emConversa(connId: number, phone: string) {
  const r = await db.execute(sql`
    select 1 from messages m join conversations c on c.id = m.conversation_id
     where c.connection_id = ${connId} and c.phone = ${phone} and m.from_me and m.campaign_id is null
       and m.type <> 'call' and m.created_at > now() - interval '3 days' limit 1`);
  return (r as unknown as unknown[]).length > 0;
}

/** Libera números cuja pausa já passou (limpa o aviso). */
export async function liberarPausasVencidas() {
  await db.update(connections).set({ pausedUntil: null, pauseReason: null })
    .where(and(isNotNull(connections.pausedUntil), sql`${connections.pausedUntil} < now()`));
}

