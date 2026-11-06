import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, contacts, conversations, messages, users } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { arquivoUpload, UPLOAD_DIR } from '../lib/uploads.js';
import { estadoDe } from '../lib/astra.js';
import { efetiva, limitesNumero, padraoCampanha, type Seguranca } from '../lib/seguranca.js';
import { enviarConteudo, ligarCom } from '../lib/worker.js';
import { normalizarTelefone } from '../lib/telefone.js';

export const campaignsRouter = Router();
campaignsRouter.use(exigirLogin, exigirEmpresa);

// --- upload da mídia ----------------------------------------------------------------------------
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 64);
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8)}`),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

campaignsRouter.post('/upload', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Arquivo maior que ${MAX_MB} MB.` : 'Falha ao enviar o arquivo.' });
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    // nome original vem em latin1 pelo multer
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    res.json({ path: f.filename, name, mime: f.mimetype, size: f.size });
  });
});

// --- contadores ---------------------------------------------------------------------------------
const CONTADORES = {
  total: sql<number>`count(*)::int`,
  pending: sql<number>`count(*) filter (where ${campaignTargets.status} in ('pending','sending','warming','ringing','answered'))::int`,
  sent: sql<number>`count(*) filter (where ${campaignTargets.status} = 'sent')::int`,
  failed: sql<number>`count(*) filter (where ${campaignTargets.status} = 'failed')::int`,
  skipped: sql<number>`count(*) filter (where ${campaignTargets.status} = 'skipped')::int`,
  completed: sql<number>`count(*) filter (where ${campaignTargets.status} = 'completed')::int`,
  noAnswer: sql<number>`count(*) filter (where ${campaignTargets.status} = 'no-answer')::int`,
  delivered: sql<number>`count(*) filter (where ${campaignTargets.deliveredAt} is not null)::int`,
  read: sql<number>`count(*) filter (where ${campaignTargets.readAt} is not null)::int`,
  replied: sql<number>`count(*) filter (where ${campaignTargets.repliedAt} is not null)::int`,
  optedOut: sql<number>`count(*) filter (where ${campaignTargets.optedOut})::int`,
};

async function contadores(ids: number[]) {
  if (!ids.length) return new Map<number, Record<string, number>>();
  const l = await db.select({ campaignId: campaignTargets.campaignId, ...CONTADORES }).from(campaignTargets)
    .where(inArray(campaignTargets.campaignId, ids)).groupBy(campaignTargets.campaignId);
  return new Map(l.map(({ campaignId, ...r }) => [campaignId, r]));
}

const vazio = { total: 0, pending: 0, sent: 0, failed: 0, skipped: 0, completed: 0, noAnswer: 0, delivered: 0, read: 0, replied: 0, optedOut: 0 };

async function daEmpresa(req: any) {
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, Number(req.params.id)), eq(campaigns.tenantId, tenantDe(req))));
  return c;
}

campaignsRouter.get('/', async (req, res) => {
  const l = await db.select({
    c: campaigns, connectionName: connections.name, createdByName: users.name,
  }).from(campaigns)
    .leftJoin(connections, eq(connections.id, campaigns.connectionId))
    .leftJoin(users, eq(users.id, campaigns.createdBy))
    .where(eq(campaigns.tenantId, tenantDe(req))).orderBy(desc(campaigns.id)).limit(300);
  const cont = await contadores(l.map(x => x.c.id));
  res.json({ campaigns: l.map(x => ({ ...publica(x.c), connectionName: x.connectionName, createdByName: x.createdByName, stats: cont.get(x.c.id) || vazio })) });
});

const publica = (c: typeof campaigns.$inferSelect) => {
  const { tenantId: _t, mediaPath, ...resto } = c;
  return { ...resto, hasMedia: !!mediaPath };
};

campaignsRouter.get('/seguranca-padrao', async (req, res) => {
  res.json({ seguranca: await padraoCampanha(req.query.kind === 'call' ? 'call' : 'message') });
});

campaignsRouter.get('/:id', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const [conn] = c.connectionId ? await db.select().from(connections).where(eq(connections.id, c.connectionId)) : [];
  const cont = await contadores([c.id]);
  // estado do número (próximo envio, pausa de segurança, limites de hoje)
  let numero = null;
  if (conn) {
    const cfg = await efetiva(c.kind as 'message' | 'call', c.seguranca as Partial<Seguranca>);
    const l = await limitesNumero(conn, cfg);
    numero = { nextAt: conn.nextAt, pausedUntil: conn.pausedUntil && conn.pausedUntil > new Date() ? conn.pausedUntil : null, pauseReason: conn.pauseReason, ...l };
  }
  res.json({ campaign: { ...publica(c), connectionName: conn?.name ?? null, stats: cont.get(c.id) || vazio, numero } });
});

campaignsRouter.get('/:id/targets', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = Math.min(200, Math.max(10, Number(req.query.per) || 50));
  const conds: SQL[] = [eq(campaignTargets.campaignId, c.id)];
  const st = String(req.query.status || '');
  if (st === 'pending') conds.push(inArray(campaignTargets.status, ['pending', 'sending', 'warming', 'ringing', 'answered']));
  else if (st === 'replied') conds.push(isNotNull(campaignTargets.repliedAt));
  else if (st === 'read') conds.push(isNotNull(campaignTargets.readAt));
  else if (st === 'optedOut') conds.push(eq(campaignTargets.optedOut, true));
  else if (st) conds.push(eq(campaignTargets.status, st));
  const where = and(...conds);
  const [{ total }] = await db.select({ total: count() }).from(campaignTargets).where(where);
  const l = await db.select({ t: campaignTargets, conversationId: conversations.id }).from(campaignTargets)
    .leftJoin(conversations, and(sql`${conversations.connectionId} = coalesce(${campaignTargets.connectionId}, ${c.connectionId ?? 0})`, eq(conversations.phone, campaignTargets.phone)))
    .where(where).orderBy(asc(campaignTargets.id)).limit(per).offset((page - 1) * per);
  res.json({ targets: l.map(({ t: { astraRef: _a, ...t }, conversationId }) => ({ ...t, conversationId })), total, page, per });
});

// mídia da campanha (pra pré-visualizar na tela)
campaignsRouter.get('/:id/media', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c?.mediaPath) return res.status(404).end();
  res.type(c.mediaMime || 'application/octet-stream').sendFile(arquivoUpload(c.mediaPath));
});

// --- criar --------------------------------------------------------------------------------------
const criarSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à campanha.').max(120),
  kind: z.enum(['message', 'call']),
  connectionId: z.number().int(),
  connectionIds: z.array(z.number().int()).max(20).default([]),
  mentionAll: z.boolean().default(false),
  messageType: z.enum(['text', 'image', 'video', 'audio', 'document', 'poll']).default('text'),
  text: z.string().max(4096).default(''),
  textVariants: z.array(z.string().max(4096)).max(10, 'No máximo 10 versões extras.').default([]),
  buttons: z.array(z.object({
    type: z.enum(['quick_reply', 'cta_url', 'cta_call', 'cta_copy']),
    text: z.string().trim().min(1, 'Todo botão precisa de um texto.').max(25, 'Texto do botão: até 25 letras.'),
    value: z.string().trim().max(300).optional(),
  })).max(3).default([]),
  optOutButton: z.boolean().default(false),
  footer: z.string().max(60).default(''),
  pollOptions: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  pollMulti: z.boolean().default(false),
  typing: z.boolean().default(true),
  skipInvalid: z.boolean().default(true),
  media: z.object({ path: z.string(), name: z.string(), mime: z.string() }).nullable().optional(),
  callVideo: z.boolean().default(false),
  maxRingSeconds: z.number().int().min(15).max(90).default(40),
  // compatibilidade: intervalo também pode vir solto; o resto da segurança vem em `seguranca`
  minDelay: z.number().int().min(1).max(3600).optional(),
  maxDelay: z.number().int().min(1).max(3600).optional(),
  seguranca: z.record(z.unknown()).default({}),
  audience: z.object({
    all: z.boolean().optional(),
    categoryIds: z.array(z.number().int()).optional(),
    contactIds: z.array(z.number().int()).optional(),
    groups: z.array(z.object({ jid: z.string().regex(/@g\.us$/), name: z.string().max(120) })).max(200).optional(),
  }),
  start: z.boolean().default(false),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Confere o conteúdo da campanha (mensagem/ligação). Devolve o tipo final ou o erro em português. */
function validarConteudo(d: Pick<z.infer<typeof criarSchema>, 'kind' | 'messageType' | 'text' | 'media' | 'callVideo' | 'buttons' | 'optOutButton' | 'pollOptions'>): { messageType: string } | { error: string } {
  let messageType: string = d.messageType;
  if (d.kind === 'call') {
    if (!d.media) return ({ error: d.callVideo ? 'Envie o vídeo que vai passar na ligação.' : 'Envie o áudio que vai tocar na ligação.' });
    const ok = d.callVideo ? d.media.mime.startsWith('video/') : (d.media.mime.startsWith('audio/') || d.media.mime.startsWith('video/'));
    if (!ok) return ({ error: d.callVideo ? 'Pra ligação de vídeo, envie um arquivo de vídeo (MP4).' : 'Pra ligação de áudio, envie um arquivo de áudio (MP3, OGG, WAV…).' });
    messageType = d.callVideo ? 'video' : 'audio';
  } else if (messageType === 'text') {
    if (!d.text.trim()) return ({ error: 'Escreva a mensagem.' });
    if (d.buttons.length + (d.optOutButton ? 1 : 0) > 3) return ({ error: 'No máximo 3 botões (contando o "Não tenho interesse").' });
    for (const b of d.buttons) {
      if (b.type === 'cta_url' && !/^https?:\/\/\S+\.\S+/.test(b.value || '')) return ({ error: `O botão "${b.text}" precisa de um link começando com https://` });
      if (b.type === 'cta_call' && (b.value || '').replace(/\D/g, '').length < 10) return ({ error: `O botão "${b.text}" precisa de um telefone com DDD.` });
      if (b.type === 'cta_copy' && !b.value) return ({ error: `O botão "${b.text}" precisa do código a copiar.` });
    }
  } else if (messageType === 'poll') {
    if (!d.text.trim()) return ({ error: 'Escreva a pergunta da enquete.' });
    if (d.pollOptions.length < 2) return ({ error: 'A enquete precisa de pelo menos 2 opções.' });
  } else {
    if (!d.media) return ({ error: 'Envie o arquivo da mensagem.' });
    const prefixo = { image: 'image/', video: 'video/', audio: 'audio/', document: '' }[messageType];
    if (prefixo && !d.media.mime.startsWith(prefixo)) return ({ error: 'O arquivo não combina com o tipo de mensagem escolhido.' });
  }
  return { messageType };
}

campaignsRouter.post('/', async (req, res) => {
  const p = criarSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  const tid = tenantDe(req);
  const agendada = d.scheduledAt ? new Date(d.scheduledAt) : null;
  if (agendada && agendada.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'A data do agendamento já passou.' });
  // segurança anti-bloqueio: o pedido é ajustado ao piso/teto do admin (o cliente não fura)
  const seg = await efetiva(d.kind, { ...(d.minDelay ? { intervaloMin: d.minDelay } : {}), ...(d.maxDelay ? { intervaloMax: d.maxDelay } : {}), ...d.seguranca } as Partial<Seguranca>);
  if (d.kind === 'call' && seg.preMsgAtivo === false && (d.seguranca as any)?.preMsgAtivo && !seg.preMsgs.length) return res.status(400).json({ error: 'Escreva a mensagem que vai antes da ligação.' });

  const ids = [...new Set([d.connectionId, ...d.connectionIds])];
  const nums = await db.select().from(connections).where(and(inArray(connections.id, ids), eq(connections.tenantId, tid)));
  const conn = nums.find(n => n.id === d.connectionId);
  if (!conn || nums.length !== ids.length) return res.status(400).json({ error: 'Escolha um número de WhatsApp.' });

  const v = validarConteudo(d);
  if ('error' in v) return res.status(400).json({ error: v.error });
  const messageType = v.messageType;
  if (d.media && !fs.existsSync(arquivoUpload(d.media.path))) return res.status(400).json({ error: 'O arquivo enviado não foi encontrado. Envie de novo.' });

  // público: grupos do WhatsApp (a mensagem vai DENTRO do grupo)
  type Destino = { id: number | null; name: string; phone: string; isGroup?: boolean };
  let publico: Destino[] = [];
  let descadastrados = 0, semWhats = 0;
  if (d.audience.groups?.length) {
    if (d.kind === 'call') return res.status(400).json({ error: 'Ligação não pode ser feita pra grupo. Use uma campanha de mensagem.' });
    publico = d.audience.groups.map(g => ({ id: null, name: g.name, phone: g.jid, isGroup: true }));
  } else {
  let where: SQL | undefined;
  if (d.audience.contactIds?.length) where = and(eq(contacts.tenantId, tid), inArray(contacts.id, d.audience.contactIds));
  else if (d.audience.categoryIds?.length) where = and(eq(contacts.tenantId, tid), inArray(contacts.categoryId, d.audience.categoryIds));
  else if (d.audience.all) where = eq(contacts.tenantId, tid);
  if (!where) return res.status(400).json({ error: 'Escolha pra quem enviar.' });
  const todos = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, optOut: contacts.optOut, waStatus: contacts.waStatus }).from(contacts).where(where).orderBy(asc(contacts.id));
  // quem pediu pra sair nunca entra; sem WhatsApp (validado) fica de fora se a opção estiver ligada
  descadastrados = todos.filter(x => x.optOut).length;
  semWhats = d.skipInvalid ? todos.filter(x => !x.optOut && x.waStatus === 'invalid').length : 0;
  publico = todos.filter(x => !x.optOut && !(d.skipInvalid && x.waStatus === 'invalid'));
  if (!publico.length) return res.status(400).json({ error: todos.length ? 'Todos os contatos desse público se descadastraram ou não têm WhatsApp.' : 'Nenhum contato nesse público.' });
  }

  const c = await db.transaction(async tx => {
    const [c] = await tx.insert(campaigns).values({
      tenantId: tid, connectionId: conn.id, connectionIds: ids, mentionAll: d.mentionAll, createdBy: req.auth!.userId, name: d.name, kind: d.kind,
      status: agendada ? 'scheduled' : d.start ? 'running' : 'draft', scheduledAt: agendada, messageType, text: d.text,
      textVariants: d.kind === 'call' || messageType === 'audio' ? [] : d.textVariants.filter(v => v.trim()),
      buttons: messageType === 'text' && d.kind === 'message' ? d.buttons : [], optOutButton: messageType === 'text' && d.kind === 'message' && d.optOutButton,
      footer: d.footer, pollOptions: messageType === 'poll' ? d.pollOptions : [], pollMulti: d.pollMulti, typing: d.typing,
      mediaPath: d.media?.path ?? null, mediaName: d.media?.name ?? null, mediaMime: d.media?.mime ?? null,
      callVideo: d.kind === 'call' && d.callVideo, maxRingSeconds: seg.toqueMax, minDelay: seg.intervaloMin, maxDelay: seg.intervaloMax, seguranca: seg,
      startedAt: d.start && !agendada ? new Date() : null,
    }).returning();
    for (let i = 0; i < publico.length; i += 1000) {
      await tx.insert(campaignTargets).values(publico.slice(i, i + 1000).map(x => ({ campaignId: c.id, contactId: x.id, name: x.name, phone: x.phone, isGroup: !!x.isGroup })));
    }
    return c;
  });
  res.status(201).json({ campaign: publica(c), total: publico.length, excluded: { optOut: descadastrados, noWhatsapp: semWhats } });
});

// --- duplicar / reenviar ------------------------------------------------------------------------
// Cria uma campanha nova (rascunho) a partir desta, com todos ou só quem não respondeu/não leu/falhou.
// Dá pra trocar o texto. Quem pediu pra sair fica de fora.
campaignsRouter.post('/:id/duplicate', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const p = z.object({
    publico: z.enum(['todos', 'nao_responderam', 'nao_leram', 'falharam', 'nao_atenderam']).default('todos'),
    name: z.string().trim().min(2).max(120).optional(),
    text: z.string().max(4096).optional(),
    textVariants: z.array(z.string().max(4096)).max(10).optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Dados inválidos.' });
  const d = p.data;
  const filtro: Record<string, SQL> = {
    todos: sql`true`,
    nao_responderam: sql`${campaignTargets.repliedAt} is null and ${campaignTargets.status} in ('sent','completed','no-answer')`,
    nao_leram: sql`${campaignTargets.readAt} is null and ${campaignTargets.repliedAt} is null and ${campaignTargets.status} = 'sent'`,
    falharam: sql`${campaignTargets.status} = 'failed'`,
    nao_atenderam: sql`${campaignTargets.status} = 'no-answer'`,
  };
  const alvos = await db.select({ contactId: campaignTargets.contactId, name: campaignTargets.name, phone: campaignTargets.phone, isGroup: campaignTargets.isGroup })
    .from(campaignTargets)
    .leftJoin(contacts, and(eq(contacts.tenantId, c.tenantId), eq(contacts.phone, campaignTargets.phone)))
    .where(and(eq(campaignTargets.campaignId, c.id), filtro[d.publico], sql`coalesce(${contacts.optOut}, false) = false and ${campaignTargets.optedOut} = false`))
    .orderBy(asc(campaignTargets.id));
  if (!alvos.length) return res.status(400).json({ error: 'Ninguém nesse grupo pra receber de novo.' });
  const ROT: Record<string, string> = { todos: 'cópia', nao_responderam: 'quem não respondeu', nao_leram: 'quem não leu', falharam: 'quem falhou', nao_atenderam: 'quem não atendeu' };
  const nova = await db.transaction(async tx => {
    const { id: _i, status: _s, createdAt: _c, startedAt: _st, finishedAt: _f, nextAt: _n, pauseReason: _p, waitReason: _w, scheduledAt: _sc, ...resto } = c;
    const [n] = await tx.insert(campaigns).values({
      ...resto, status: 'draft', createdBy: req.auth!.userId,
      name: d.name || `${c.name} (${ROT[d.publico]})`.slice(0, 120),
      ...(d.text !== undefined ? { text: d.text } : {}), ...(d.textVariants !== undefined ? { textVariants: d.textVariants.filter(t => t.trim()) } : {}),
    }).returning();
    for (let i = 0; i < alvos.length; i += 1000) {
      await tx.insert(campaignTargets).values(alvos.slice(i, i + 1000).map(a => ({ campaignId: n.id, contactId: a.contactId, name: a.name, phone: a.phone, isGroup: a.isGroup })));
    }
    return n;
  });
  res.status(201).json({ campaign: publica(nova), total: alvos.length });
});

// --- enviar teste pra mim -----------------------------------------------------------------------
campaignsRouter.post('/test', async (req, res) => {
  const p = criarSchema.pick({ kind: true, connectionId: true, messageType: true, text: true, textVariants: true, media: true, callVideo: true, buttons: true, optOutButton: true, footer: true, pollOptions: true, pollMulti: true })
    .extend({ phone: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  const tel = normalizarTelefone(d.phone);
  if (!tel) return res.status(400).json({ error: 'Informe o seu WhatsApp com DDD.' });
  const v = validarConteudo(d);
  if ('error' in v) return res.status(400).json({ error: v.error });
  if (d.media && !fs.existsSync(arquivoUpload(d.media.path))) return res.status(400).json({ error: 'O arquivo não foi encontrado. Envie de novo.' });
  const [conn] = await db.select().from(connections).where(and(eq(connections.id, d.connectionId), eq(connections.tenantId, tenantDe(req))));
  if (!conn) return res.status(400).json({ error: 'Escolha um número de WhatsApp.' });
  if (!(await estadoDe(conn.sessionId))?.paired) return res.status(400).json({ error: `O número "${conn.name}" está desconectado. Conecte em Conexões pra testar.` });
  try {
    if (d.kind === 'call') {
      await ligarCom(conn, { mediaPath: d.media!.path, callVideo: d.callVideo }, tel, 40_000);
      return res.json({ ok: true, kind: 'call' });
    }
    await enviarConteudo(conn, {
      messageType: v.messageType, text: d.text, textVariants: [], buttons: d.buttons.map(b => ({ ...b, value: b.value })), optOutButton: d.optOutButton, footer: d.footer,
      pollOptions: d.pollOptions, pollMulti: d.pollMulti, mediaPath: d.media?.path ?? null, mediaMime: d.media?.mime ?? null, mediaName: d.media?.name ?? null, typing: false, mentionAll: false,
    }, tel, (req.auth!.name || '').split(' ')[0]);
    res.json({ ok: true, kind: 'message' });
  } catch (e) {
    res.status(400).json({ error: 'Não foi possível enviar o teste: ' + ((e as Error).message || 'erro') });
  }
});

// --- controle -----------------------------------------------------------------------------------
campaignsRouter.post('/:id/start', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) return res.status(400).json({ error: 'Essa campanha não pode ser iniciada agora.' });
  const [conn] = c.connectionId ? await db.select().from(connections).where(eq(connections.id, c.connectionId)) : [];
  if (!conn) return res.status(400).json({ error: 'O número de WhatsApp desta campanha foi removido.' });
  const st = await estadoDe(conn.sessionId);
  if (!st?.paired) return res.status(400).json({ error: `O número "${conn.name}" está desconectado. Conecte em Conexões antes de iniciar.` });
  // outra campanha já usando esse número: esta entra na fila (o motor atende uma por vez por número)
  await db.update(campaigns).set({ status: 'running', pauseReason: null, nextAt: null, scheduledAt: null, startedAt: c.startedAt ?? new Date() }).where(eq(campaigns.id, c.id));
  res.json({ ok: true });
});

// agendar / mudar o horário (rascunho, pausada ou já agendada)
campaignsRouter.post('/:id/schedule', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) return res.status(400).json({ error: 'Essa campanha não pode ser agendada agora.' });
  const p = z.object({ scheduledAt: z.string().datetime({ offset: true }) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Escolha a data e a hora.' });
  const quando = new Date(p.data.scheduledAt);
  if (quando.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'A data do agendamento já passou.' });
  await db.update(campaigns).set({ status: 'scheduled', scheduledAt: quando, pauseReason: null }).where(eq(campaigns.id, c.id));
  res.json({ ok: true });
});

campaignsRouter.post('/:id/pause', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (!['running', 'scheduled'].includes(c.status)) return res.status(400).json({ error: 'Só dá pra pausar campanha em andamento ou agendada.' });
  await db.update(campaigns).set({ status: 'paused', pauseReason: 'Pausada por ' + req.auth!.name + '.' }).where(eq(campaigns.id, c.id));
  res.json({ ok: true });
});

campaignsRouter.post('/:id/cancel', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (['done', 'canceled'].includes(c.status)) return res.status(400).json({ error: 'A campanha já terminou.' });
  await db.update(campaigns).set({ status: 'canceled', finishedAt: new Date(), nextAt: null }).where(eq(campaigns.id, c.id));
  // ligação em andamento não tem como ser cortada pelo AstraCalls: só deixa de ser acompanhada
  await db.update(campaignTargets).set({ status: 'failed', error: 'Campanha cancelada durante a ligação.', doneAt: new Date() })
    .where(and(eq(campaignTargets.campaignId, c.id), inArray(campaignTargets.status, ['sending', 'ringing', 'answered'])));
  res.json({ ok: true });
});

campaignsRouter.delete('/:id', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  if (['running', 'scheduled'].includes(c.status)) return res.status(400).json({ error: 'Pause ou cancele a campanha antes de excluir.' });
  await db.delete(campaigns).where(eq(campaigns.id, c.id));
  if (c.mediaPath) {
    const [{ n }] = await db.select({ n: count() }).from(campaigns).where(eq(campaigns.mediaPath, c.mediaPath));
    const [{ m }] = await db.select({ m: count() }).from(messages).where(eq(messages.mediaPath, c.mediaPath));
    if (n === 0 && m === 0) fs.rm(arquivoUpload(c.mediaPath), { force: true }, () => {});
  }
  res.json({ ok: true });
});

// relatório em CSV (abre no Excel)
campaignsRouter.get('/:id/export', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const l = await db.select().from(campaignTargets).where(eq(campaignTargets.campaignId, c.id)).orderBy(asc(campaignTargets.id));
  const ROTULO: Record<string, string> = { pending: 'Na fila', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou', skipped: 'Pulado (descadastrado)', ringing: 'Chamando', answered: 'Em ligação', completed: 'Atendeu', 'no-answer': 'Não atendeu' };
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmt = (d: Date | null) => (d ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  const linhas = [['Nome', 'Telefone', 'Situação', 'Duração (s)', 'Quando', 'Entregue', 'Lida', 'Respondeu', 'Resposta', 'Descadastrou', 'Erro'].map(esc).join(';')]
    .concat(l.map(t => [t.name, t.phone, ROTULO[t.status] || t.status, t.durationMs ? Math.round(t.durationMs / 1000) : '', fmt(t.doneAt),
      fmt(t.deliveredAt), fmt(t.readAt), fmt(t.repliedAt), t.reply || '', t.optedOut ? 'Sim' : '', t.error || ''].map(esc).join(';')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campanha-${c.id}.csv"`);
  res.send('﻿' + linhas.join('\r\n'));
});
