import { Router } from 'express';
import fs from 'node:fs';
import { and, count, desc, eq, gt, ilike, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { campaigns, connections, contacts, conversations, messages, users } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { astra, AstraErro } from '../lib/astra.js';
import { atualizarPerfil, descadastrar, gravarMensagem, mesmoTelefone } from '../lib/conversas.js';
import { arquivoUpload, base64DoUpload } from '../lib/uploads.js';

export const conversationsRouter = Router();
conversationsRouter.use(exigirLogin, exigirEmpresa);

async function daEmpresa(req: any) {
  const [c] = await db.select().from(conversations).where(and(eq(conversations.id, Number(req.params.id)), eq(conversations.tenantId, tenantDe(req))));
  return c;
}

conversationsRouter.get('/', async (req, res) => {
  const tid = tenantDe(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = Math.min(100, Math.max(10, Number(req.query.per) || 40));
  const conds: SQL[] = [eq(conversations.tenantId, tid)];
  const filtro = String(req.query.filter || 'respondidas');
  if (filtro === 'respondidas') conds.push(isNotNull(conversations.lastInboundAt));
  if (filtro === 'nao_lidas') conds.push(gt(conversations.unread, 0));
  if (req.query.connectionId) conds.push(eq(conversations.connectionId, Number(req.query.connectionId)));
  if (req.query.campaignId) conds.push(eq(conversations.lastCampaignId, Number(req.query.campaignId)));
  const q = String(req.query.q || '').trim();
  if (q) {
    const dig = q.replace(/\D/g, '');
    conds.push(or(ilike(conversations.name, `%${q}%`), ilike(contacts.name, `%${q}%`), ...(dig.length >= 3 ? [ilike(conversations.phone, `%${dig}%`)] : []))!);
  }
  const where = and(...conds);
  const [{ total }] = await db.select({ total: count() }).from(conversations).leftJoin(contacts, eq(contacts.id, conversations.contactId)).where(where);
  const l = await db.select({
    id: conversations.id, phone: conversations.phone, name: sql<string>`coalesce(nullif(${contacts.name}, ''), ${conversations.name})`,
    lastMessageAt: conversations.lastMessageAt, lastPreview: conversations.lastPreview, lastFromMe: conversations.lastFromMe, unread: conversations.unread,
    connectionName: connections.name, campaignName: campaigns.name, optOut: sql<boolean>`coalesce(${contacts.optOut}, false)`,
    avatarUrl: conversations.avatarUrl, waName: conversations.waName, profileAt: conversations.profileAt,
  }).from(conversations)
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(connections, eq(connections.id, conversations.connectionId))
    .leftJoin(campaigns, eq(campaigns.id, conversations.lastCampaignId))
    .where(where).orderBy(desc(conversations.lastMessageAt)).limit(per).offset((page - 1) * per);
  // foto/nome de quem ainda não tem (ou está velho): busca em segundo plano, aparece na próxima atualização
  const velhas = l.filter(c => !c.profileAt || Date.now() - new Date(c.profileAt).getTime() > (c.avatarUrl ? 12 : 1) * 3600_000).slice(0, 8);
  if (velhas.length) void (async () => {
    for (const v of velhas) { const [c] = await db.select().from(conversations).where(eq(conversations.id, v.id)); if (c) await atualizarPerfil(c).catch(() => {}) }
  })();
  res.json({ conversations: l.map(({ profileAt: _p, ...c }) => c), total, page, per });
});

conversationsRouter.get('/unread', async (req, res) => {
  const [{ n }] = await db.select({ n: count() }).from(conversations).where(and(eq(conversations.tenantId, tenantDe(req)), gt(conversations.unread, 0)));
  res.json({ unread: n });
});

conversationsRouter.get('/:id', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  // vincula ao contato se ele foi cadastrado depois
  let contato = c.contactId ? (await db.select().from(contacts).where(eq(contacts.id, c.contactId)))[0] : undefined;
  if (!contato) {
    [contato] = await db.select().from(contacts).where(and(eq(contacts.tenantId, c.tenantId), mesmoTelefone(contacts.phone, c.phone))).limit(1);
    if (contato) await db.update(conversations).set({ contactId: contato.id }).where(eq(conversations.id, c.id));
  }
  const perfil = await atualizarPerfil(c).catch(() => c);
  const [conn] = await db.select({ name: connections.name, phone: connections.phone }).from(connections).where(eq(connections.id, c.connectionId));
  const [camp] = c.lastCampaignId ? await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.id, c.lastCampaignId)) : [];
  res.json({ conversation: {
    id: c.id, phone: c.phone, name: contato?.name || c.name || perfil.waName || '', waName: perfil.waName, avatarUrl: perfil.avatarUrl, unread: c.unread, connectionName: conn?.name, connectionPhone: conn?.phone,
    contactId: contato?.id ?? null, optOut: !!contato?.optOut, campaign: camp ?? null,
  } });
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const limite = Math.min(100, Number(req.query.limit) || 50);
  const conds: SQL[] = [eq(messages.conversationId, c.id)];
  if (req.query.before) conds.push(lt(messages.id, Number(req.query.before)));
  if (req.query.after) conds.push(gt(messages.id, Number(req.query.after)));
  const l = await db.select({
    id: messages.id, fromMe: messages.fromMe, type: messages.type, text: messages.text, mediaName: messages.mediaName, mediaMime: messages.mediaMime,
    hasMedia: sql<boolean>`(${messages.mediaPath} is not null or (${messages.waId} is not null and ${messages.type} in ('image','video','audio','document','sticker')))`,
    status: messages.status, createdAt: messages.createdAt, campaignId: messages.campaignId, sentByName: users.name,
  }).from(messages).leftJoin(users, eq(users.id, messages.sentBy)).where(and(...conds))
    .orderBy(req.query.after ? messages.id : desc(messages.id)).limit(limite);
  res.json({ messages: req.query.after ? l : l.reverse() });
});

// abriu a conversa: zera não lidas e avisa o WhatsApp (tique azul pro cliente)
conversationsRouter.post('/:id/read', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (c.unread > 0) {
    const ultimas = await db.select({ waId: messages.waId }).from(messages)
      .where(and(eq(messages.conversationId, c.id), eq(messages.fromMe, false), isNotNull(messages.waId))).orderBy(desc(messages.id)).limit(Math.min(c.unread, 20));
    await db.update(conversations).set({ unread: 0 }).where(eq(conversations.id, c.id));
    const ids = ultimas.map(m => m.waId!).filter(id => !id.startsWith('vote-'));
    const [conn] = await db.select().from(connections).where(eq(connections.id, c.connectionId));
    if (conn && ids.length) astra('POST', `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages/seen`, { to: c.phone, messageIds: ids }, { timeoutMs: 15_000 }).catch(() => {});
  }
  res.json({ ok: true });
});

const TIPO_POR_MIME = (mime: string) => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';

// responder pela tela (texto ou arquivo enviado antes em /campaigns/upload)
conversationsRouter.post('/:id/messages', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const p = z.object({ text: z.string().max(4096).default(''), media: z.object({ path: z.string(), name: z.string(), mime: z.string() }).nullable().optional() }).safeParse(req.body);
  if (!p.success || (!p.data.text.trim() && !p.data.media)) return res.status(400).json({ error: 'Escreva uma mensagem ou anexe um arquivo.' });
  const [conn] = await db.select().from(connections).where(eq(connections.id, c.connectionId));
  if (!conn) return res.status(400).json({ error: 'O número desta conversa foi removido.' });
  const base = `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages`;
  const { text, media } = p.data;
  try {
    let r: { id?: string };
    let tipo = 'text';
    if (media) {
      if (!fs.existsSync(arquivoUpload(media.path))) return res.status(400).json({ error: 'Arquivo não encontrado. Envie de novo.' });
      tipo = TIPO_POR_MIME(media.mime);
      const corpo: Record<string, unknown> = { to: c.phone, base64: base64DoUpload(media.path), mimetype: media.mime };
      if (tipo === 'audio') corpo.ptt = /ogg|opus|webm/.test(media.mime);
      else if (text.trim()) corpo.caption = text;
      if (tipo === 'document') corpo.filename = media.name;
      r = await astra('POST', `${base}/${tipo}`, corpo, { timeoutMs: 180_000 });
    } else {
      r = await astra('POST', `${base}/text`, { to: c.phone, text }, { timeoutMs: 30_000 });
    }
    const msg = await gravarMensagem(c, { waId: r?.id ?? null, fromMe: true, type: tipo, text: tipo === 'audio' ? '' : text, mediaPath: media?.path ?? null, mediaName: media?.name ?? null, mediaMime: media?.mime ?? null, sentBy: req.auth!.userId });
    res.status(201).json({ message: msg });
  } catch (e) {
    const err = e as AstraErro;
    res.status(err.status === 503 ? 400 : 502).json({ error: err.status === 503 ? `O número "${conn.name}" está desconectado.` : err.message });
  }
});

// mídia da mensagem: a que a empresa enviou fica no servidor; a recebida vem do AstraCalls
conversationsRouter.get('/messages/:mid/media', async (req, res) => {
  const [m] = await db.select({ m: messages, conv: conversations }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, Number(req.params.mid)), eq(conversations.tenantId, tenantDe(req))));
  if (!m) return res.status(404).end();
  if (m.m.mediaPath) return res.type(m.m.mediaMime || 'application/octet-stream').sendFile(arquivoUpload(m.m.mediaPath));
  if (!m.m.waId) return res.status(404).end();
  const [conn] = await db.select().from(connections).where(eq(connections.id, m.conv.connectionId));
  if (!conn) return res.status(404).end();
  const r = await fetch(`${(process.env.ASTRACALLS_URL || '').replace(/\/$/, '')}/api/sessions/${encodeURIComponent(conn.sessionId)}/messages/${encodeURIComponent(m.m.waId)}/media`, {
    headers: { 'X-API-Key': process.env.ASTRACALLS_API_KEY || '' }, signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!r?.ok) return res.status(404).end();
  res.setHeader('Content-Type', r.headers.get('content-type') || m.m.mediaMime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(await r.arrayBuffer()));
});

// bloquear/liberar envios de campanha pra este contato
conversationsRouter.post('/:id/optout', async (req, res) => {
  const c = await daEmpresa(req);
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (req.body?.optOut) await descadastrar(c.tenantId, c.phone, c.name);
  else await db.update(contacts).set({ optOut: false, optOutAt: null }).where(and(eq(contacts.tenantId, c.tenantId), mesmoTelefone(contacts.phone, c.phone)));
  const [contato] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, c.tenantId), mesmoTelefone(contacts.phone, c.phone))).limit(1);
  if (contato && !c.contactId) await db.update(conversations).set({ contactId: contato.id }).where(eq(conversations.id, c.id));
  res.json({ ok: true });
});
