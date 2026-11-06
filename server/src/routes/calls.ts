import { Router, type Request, type Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/client.js';
import { connections, conversations, users } from '../db/schema.js';
import { exigirEmpresa, exigirLogin, tenantDe } from '../lib/auth.js';
import { astra, AstraErro, astraChave, astraUrl, estadoDe, ouvintesEventos } from '../lib/astra.js';
import { conversaDe, gravarMensagem } from '../lib/conversas.js';

// Ligar e atender pelo navegador (mesmo esquema do Clara v2 / InoovaCall): a chave do AstraCalls nunca
// vai pro navegador — a negociação WebRTC (SDP) e o áudio por WebSocket (PCM 16 kHz) passam por aqui.
// As chamadas em andamento ficam em memória; o navegador consulta /api/calls/active a cada 2 s.

type Chamada = {
  callId: string; sid: string; connId: number; connName: string; tenantId: number;
  direcao: 'saida' | 'entrada'; telefone: string; nome: string; conversationId: number | null;
  status: 'chamando' | 'tocando' | 'em_andamento' | 'encerrada';
  userId: number | null; userNome: string; inicio: number; atendidaEm: number | null;
};
const chamadas = new Map<string, Chamada>();
const publico = (c: Chamada) => ({
  callId: c.callId, direcao: c.direcao, telefone: c.telefone, nome: c.nome, conversationId: c.conversationId, connName: c.connName,
  status: c.status, userId: c.userId, userNome: c.userNome, inicio: c.inicio, atendidaEm: c.atendidaEm,
});
const clienteDe = (userId: number) => `disparo_u${userId}`;
const duracao = (seg: number) => (seg >= 60 ? `${Math.floor(seg / 60)}min ${seg % 60}s` : `${seg}s`);

async function encerrou(c: Chamada, motivo = '') {
  if (c.status === 'encerrada') return;
  const atendida = !!c.atendidaEm;
  c.status = 'encerrada';
  setTimeout(() => chamadas.delete(c.callId), 6000); // o navegador ainda vê "encerrada" por uns segundos
  if (!c.conversationId) return;
  const seg = atendida ? Math.round((Date.now() - c.atendidaEm!) / 1000) : 0;
  const texto = c.direcao === 'saida'
    ? (atendida ? `📞 Ligação feita por ${c.userNome || 'atendente'} (${duracao(seg)})` : `📞 Ligação de ${c.userNome || 'atendente'} não atendida`)
    : (atendida ? `📞 Ligação recebida, atendida por ${c.userNome || 'atendente'} (${duracao(seg)})` : `📞 Ligação perdida${motivo === 'recusada' ? ' (recusada)' : ''}`);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, c.conversationId));
  if (conv) await gravarMensagem(conv, { waId: `livecall-${c.callId}`, fromMe: c.direcao === 'saida', type: 'call', text: texto, sentBy: c.userId }).catch(() => {});
}

// eventos do AstraCalls (SSE): ligação chegando, mudança de status, fim
ouvintesEventos.push(async (ev: any) => {
  if (ev?.type === 'incoming' && ev.sessionId) {
    const [conn] = await db.select().from(connections).where(eq(connections.sessionId, String(ev.sessionId)));
    if (!conn) return;
    const telefone = String(ev.phone || '').replace(/\D/g, '') || String(ev.peer || '').split('@')[0].replace(/\D/g, '');
    const conv = telefone.length >= 10 ? await conversaDe(conn, telefone, String(ev.name || '')) : null;
    chamadas.set(String(ev.id), {
      callId: String(ev.id), sid: conn.sessionId, connId: conn.id, connName: conn.name, tenantId: conn.tenantId, direcao: 'entrada',
      telefone, nome: conv?.name || String(ev.name || ''), conversationId: conv?.id ?? null, status: 'tocando',
      userId: null, userNome: '', inicio: Date.now(), atendidaEm: null,
    });
    return;
  }
  const c = chamadas.get(String(ev?.id || ''));
  if (!c) return;
  if (ev.type === 'call-status') {
    const st = String(ev.status || '').toLowerCase();
    if (/connected|active|in_progress|answered|accepted/.test(st) && c.status !== 'em_andamento') { c.status = 'em_andamento'; c.atendidaEm = Date.now() }
    else if (/ringing|offer/.test(st) && c.status === 'chamando') c.status = 'tocando';
  } else if (ev.type === 'call-ended') await encerrou(c, String(ev.reason || ''));
});

export const callsRouter = Router();
callsRouter.use(exigirLogin, exigirEmpresa);
const erro = (res: Response, status: number, error: string) => res.status(status).json({ error });

function minha(req: Request, res: Response): Chamada | null {
  const c = chamadas.get(String(req.params.callId));
  if (!c || c.tenantId !== tenantDe(req)) { erro(res, 404, 'Essa ligação já terminou.'); return null }
  return c;
}

callsRouter.get('/active', (req, res) => {
  res.json({ calls: [...chamadas.values()].filter(c => c.tenantId === tenantDe(req)).map(publico) });
});

/** Ligar pro contato da conversa, pelo número da conversa. */
callsRouter.post('/dial', async (req, res) => {
  const tid = tenantDe(req);
  const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, Number(req.body?.conversationId)), eq(conversations.tenantId, tid)));
  if (!conv) return erro(res, 404, 'Conversa não encontrada.');
  const [conn] = await db.select().from(connections).where(eq(connections.id, conv.connectionId));
  if (!conn) return erro(res, 400, 'O número desta conversa foi removido.');
  if (!(await estadoDe(conn.sessionId))?.paired) return erro(res, 400, `O número "${conn.name}" está desconectado.`);
  if ([...chamadas.values()].some(c => c.connId === conn.id && c.status !== 'encerrada')) return erro(res, 409, 'Esse número já está numa ligação agora.');
  let callId: string;
  try {
    const r = await astra<{ call?: { callId: string }; callId?: string }>('POST', `/api/sessions/${encodeURIComponent(conn.sessionId)}/calls`,
      { phone: conv.phone, duration_ms: 3_600_000, video: false }, { clientId: clienteDe(req.auth!.userId), timeoutMs: 30_000 });
    callId = String(r.call?.callId || r.callId || '');
    if (!callId) throw new AstraErro('sem id da ligação', 502);
  } catch (e) { return erro(res, 502, 'Não consegui ligar: ' + (e as Error).message) }
  const c: Chamada = {
    callId, sid: conn.sessionId, connId: conn.id, connName: conn.name, tenantId: tid, direcao: 'saida', telefone: conv.phone, nome: conv.name,
    conversationId: conv.id, status: 'chamando', userId: req.auth!.userId, userNome: req.auth!.name, inicio: Date.now(), atendidaEm: null,
  };
  chamadas.set(callId, c);
  res.json({ call: publico(c) });
});

/** Negociação WebRTC: o navegador manda a oferta, devolvemos a resposta do AstraCalls. */
callsRouter.post('/:callId/sdp', async (req, res) => {
  const c = minha(req, res); if (!c) return;
  try {
    const r = await astra<{ sdp_answer: string }>('POST', `/api/sessions/${encodeURIComponent(c.sid)}/calls/${encodeURIComponent(c.callId)}/webrtc`, { sdp_offer: String(req.body?.sdp_offer || '') }, { clientId: clienteDe(req.auth!.userId) });
    res.json({ sdp_answer: r.sdp_answer });
  } catch (e) { erro(res, 502, 'Áudio: ' + (e as Error).message) }
});

callsRouter.post('/:callId/accept', async (req, res) => {
  const c = minha(req, res); if (!c) return;
  if (c.direcao !== 'entrada') return erro(res, 400, 'Essa ligação não é recebida.');
  try { await astra('POST', `/api/sessions/${encodeURIComponent(c.sid)}/calls/${encodeURIComponent(c.callId)}/accept`, {}, { clientId: clienteDe(req.auth!.userId), timeoutMs: 20_000 }) }
  catch (e) {
    if ((e as AstraErro).status === 409) return erro(res, 409, 'Outra pessoa já atendeu essa ligação.');
    return erro(res, 502, 'Não consegui atender: ' + (e as Error).message);
  }
  c.userId = req.auth!.userId; c.userNome = req.auth!.name; c.status = 'em_andamento'; c.atendidaEm = Date.now();
  res.json({ call: publico(c) });
});

callsRouter.post('/:callId/reject', async (req, res) => {
  const c = minha(req, res); if (!c) return;
  await astra('POST', `/api/sessions/${encodeURIComponent(c.sid)}/calls/${encodeURIComponent(c.callId)}/reject`, {}, { clientId: clienteDe(req.auth!.userId), timeoutMs: 20_000 }).catch(() => {});
  await encerrou(c, 'recusada');
  res.json({ ok: true });
});

callsRouter.post('/:callId/hangup', async (req, res) => {
  const c = minha(req, res); if (!c) return;
  await astra('DELETE', `/api/sessions/${encodeURIComponent(c.sid)}/calls/${encodeURIComponent(c.callId)}`, undefined, { clientId: clienteDe(req.auth!.userId), timeoutMs: 20_000 }).catch(() => {});
  await encerrou(c, 'desligada');
  res.json({ ok: true });
});

callsRouter.post('/:callId/diag', (req, res) => {
  console.log('[ligação diag]', req.params.callId, JSON.stringify(req.body).slice(0, 400));
  res.json({ ok: true });
});

// --- áudio por WebSocket (quando o WebRTC/UDP não passa) --------------------------------------
const wss = new WebSocketServer({ noServer: true, handleProtocols: p => (p.has('pcm16') ? 'pcm16' : false) });

/** "upgrade" do servidor HTTP. Rota: /api/calls/<callId>/ws?token=... (devolve false se não for dela). */
export async function tratarUpgradeLigacao(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url || '', 'http://x');
  const m = url.pathname.match(/^\/api\/calls\/([^/]+)\/ws$/);
  if (!m) return false;
  let userId = 0, tenantId = 0;
  try {
    const uid = (jwt.verify(url.searchParams.get('token') || '', process.env.JWT_SECRET || '') as { uid: number }).uid;
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    if (u?.active && u.tenantId) { userId = u.id; tenantId = u.tenantId }
  } catch { /* token inválido */ }
  const c = chamadas.get(decodeURIComponent(m[1]));
  if (!userId || !c || c.tenantId !== tenantId) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return true }
  wss.handleUpgrade(req, socket, head, cliente => {
    const alvo = astraUrl().replace(/^http/, 'ws') + `/api/sessions/${encodeURIComponent(c.sid)}/calls/${encodeURIComponent(c.callId)}/ws?apiKey=${encodeURIComponent(astraChave())}`;
    const astraWs = new WebSocket(alvo, ['pcm16'], { headers: { 'X-Client-Id': clienteDe(userId) } });
    const fila: Buffer[] = [];
    astraWs.on('open', () => { for (const f of fila.splice(0)) astraWs.send(f) });
    cliente.on('message', (d: Buffer, bin: boolean) => {
      if (!bin) return;
      if (astraWs.readyState === WebSocket.OPEN) astraWs.send(d); else if (fila.length < 50) fila.push(d);
    });
    astraWs.on('message', (d: Buffer, bin: boolean) => { if (bin && cliente.readyState === WebSocket.OPEN) cliente.send(d) });
    const fechar = () => { try { cliente.close() } catch { /* */ } try { astraWs.close() } catch { /* */ } };
    cliente.on('close', fechar); astraWs.on('close', fechar);
    cliente.on('error', fechar); astraWs.on('error', e => { console.warn('[ligação ws]', c.callId, (e as Error).message); fechar() });
  });
  return true;
}
