import express, { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connections } from '../db/schema.js';
import { assinaturaValida, aplicarLimite, aplicarRestricao } from '../lib/saude.js';
import { receberMensagem, receberRecibo, receberVoto } from '../lib/conversas.js';

// Entregas do AstraCalls: { session, event, timestamp, data }, assinadas com o segredo da conexão.
// Corpo cru (express.raw) porque a assinatura é calculada sobre os bytes exatos.
export const webhooksRouter = Router();

webhooksRouter.post('/astra/:id', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const [conn] = await db.select().from(connections).where(eq(connections.id, Number(req.params.id) || 0));
  if (!conn) return res.status(404).end();
  const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!assinaturaValida(conn.webhookSecret, corpo, req.header('x-webhook-signature'))) return res.status(401).end();
  let ev: any;
  try { ev = JSON.parse(corpo.toString('utf8')) } catch { return res.status(400).end() }
  if (ev?.session && ev.session !== conn.sessionId) return res.status(400).end();
  res.status(200).json({ ok: true }); // responde logo; processa em seguida
  try {
    const d = ev?.data || {};
    switch (ev?.event) {
      case 'message': await receberMensagem(conn, d); break;
      case 'receipt': await receberRecibo(conn, d); break;
      case 'poll_vote': await receberVoto(conn, d); break;
      case 'restriction': await aplicarRestricao(conn, d); break;
      case 'message_capping': await aplicarLimite(conn, d.capping); break;
    }
  } catch (e) {
    console.error('[webhook]', ev?.event, (e as Error).message);
  }
});
