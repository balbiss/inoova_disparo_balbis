import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { campaigns, campaignTargets, connections, contacts, conversations, messages } from '../db/schema.js';
import { astra } from './astra.js';

type Conexao = typeof connections.$inferSelect;

// Palavras que descadastram (mensagem inteira, sem diferenciar maiúsculas/acentos).
const PALAVRAS_SAIR = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'nao quero', 'nao tenho interesse', 'nao quero mais', 'me tira', 'me tire'];
export const TEXTO_BOTAO_SAIR = 'Não tenho interesse';
export const ID_BOTAO_SAIR = 'optout';
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[.!]+$/, '');
export const pedeDescadastro = (texto: string) => {
  const t = semAcento(texto);
  return PALAVRAS_SAIR.includes(t) || t === semAcento(TEXTO_BOTAO_SAIR) || t === ID_BOTAO_SAIR;
};

const PREVIA: Record<string, string> = { image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contact: '👤 Contato', poll: '📊 Enquete', call: '📞 Ligação' };
export const previa = (tipo: string, texto: string) => (texto?.trim() ? texto.trim().slice(0, 140) : PREVIA[tipo] || 'Mensagem');

/** Acha/cria a conversa do telefone naquele número da empresa. */
export async function conversaDe(conn: Conexao, phone: string, nome = '') {
  const [ja] = await db.select().from(conversations).where(and(eq(conversations.connectionId, conn.id), eq(conversations.phone, phone)));
  if (ja) {
    if (nome && !ja.name) await db.update(conversations).set({ name: nome }).where(eq(conversations.id, ja.id));
    return ja;
  }
  const [contato] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, conn.tenantId), eq(contacts.phone, phone)));
  const [nova] = await db.insert(conversations).values({
    tenantId: conn.tenantId, connectionId: conn.id, phone, contactId: contato?.id ?? null, name: contato?.name || nome || '',
  }).onConflictDoNothing().returning();
  if (nova) return nova;
  const [c] = await db.select().from(conversations).where(and(eq(conversations.connectionId, conn.id), eq(conversations.phone, phone)));
  return c;
}

type NovaMsg = {
  waId?: string | null; fromMe: boolean; type?: string; text?: string; mediaName?: string | null; mediaMime?: string | null; mediaPath?: string | null;
  status?: string | null; campaignId?: number | null; sentBy?: number | null; at?: Date;
};

/** Grava a mensagem (sem duplicar pelo id do WhatsApp) e atualiza a conversa. Devolve null se já existia. */
export async function gravarMensagem(conv: typeof conversations.$inferSelect, m: NovaMsg) {
  const quando = m.at ?? new Date();
  const [nova] = await db.insert(messages).values({
    conversationId: conv.id, waId: m.waId ?? null, fromMe: m.fromMe, type: m.type || 'text', text: m.text || '',
    mediaName: m.mediaName ?? null, mediaMime: m.mediaMime ?? null, mediaPath: m.mediaPath ?? null,
    status: m.fromMe ? (m.status || 'sent') : null, campaignId: m.campaignId ?? null, sentBy: m.sentBy ?? null, createdAt: quando,
  }).onConflictDoNothing().returning();
  if (!nova) return null;
  await db.update(conversations).set({
    lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${quando.toISOString()}::timestamptz)`,
    lastPreview: previa(nova.type, nova.text), lastFromMe: m.fromMe,
    ...(m.fromMe ? {} : { unread: sql`${conversations.unread} + 1`, lastInboundAt: quando }),
    ...(m.campaignId ? { lastCampaignId: m.campaignId } : {}),
  }).where(eq(conversations.id, conv.id));
  return nova;
}

/** Último disparo de campanha pra esse telefone (últimos 30 dias) — a resposta é creditada a ele. */
async function ultimoAlvo(tenantId: number, phone: string) {
  const [a] = await db.select({ id: campaignTargets.id, campaignId: campaignTargets.campaignId, repliedAt: campaignTargets.repliedAt })
    .from(campaignTargets).innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(and(eq(campaigns.tenantId, tenantId), eq(campaignTargets.phone, phone), inArray(campaignTargets.status, ['sent', 'completed', 'no-answer', 'answered']), gte(campaignTargets.doneAt, new Date(Date.now() - 30 * 86400_000))))
    .orderBy(desc(campaignTargets.doneAt)).limit(1);
  return a;
}

/** Marca o contato como descadastrado (cria o contato se ainda não existir, pra ficar bloqueado). */
export async function descadastrar(tenantId: number, phone: string, nome = '') {
  await db.insert(contacts).values({ tenantId, phone, name: nome, optOut: true, optOutAt: new Date() })
    .onConflictDoUpdate({ target: [contacts.tenantId, contacts.phone], set: { optOut: true, optOutAt: new Date() } });
}

/** Mensagem recebida (ou enviada pelo celular) vinda do AstraCalls. */
export async function receberMensagem(conn: Conexao, d: any) {
  if (d.isGroup || String(d.chat || '').endsWith('@g.us') || String(d.chat || '').includes('broadcast') || String(d.chat || '').includes('newsletter')) return;
  const phone = String(d.chatPhone || '').replace(/\D/g, '') || (String(d.chat || '').endsWith('@s.whatsapp.net') ? String(d.chat).split('@')[0].replace(/\D/g, '') : '');
  if (!phone || phone.length < 10) return;
  const tipo = String(d.type || 'text');
  if (['reaction', 'protocol', 'unknown', 'group_status'].includes(tipo) && !d.text) return;
  const conv = await conversaDe(conn, phone, d.fromMe ? '' : String(d.pushName || ''));
  const temMidia = ['image', 'video', 'audio', 'document', 'sticker'].includes(tipo);
  const nova = await gravarMensagem(conv, {
    waId: d.id, fromMe: !!d.fromMe, type: tipo, text: String(d.text || ''), at: d.timestamp ? new Date(Number(d.timestamp)) : undefined,
    mediaMime: temMidia ? midiaMimeDoRaw(d.raw, tipo) : null, mediaName: temMidia ? midiaNomeDoRaw(d.raw) : null,
  });
  if (!nova || d.fromMe) return;

  // resposta conta pro relatório da campanha
  const alvo = await ultimoAlvo(conn.tenantId, phone);
  const texto = String(d.text || '');
  const sair = tipo === 'text' && pedeDescadastro(texto);
  if (alvo && !alvo.repliedAt) {
    await db.update(campaignTargets).set({ repliedAt: new Date(), reply: previa(tipo, texto) }).where(eq(campaignTargets.id, alvo.id));
  }
  if (sair) {
    await descadastrar(conn.tenantId, phone, String(d.pushName || ''));
    if (alvo) await db.update(campaignTargets).set({ optedOut: true }).where(eq(campaignTargets.id, alvo.id));
    // confirma pra pessoa (educação + evita denúncia)
    try {
      const r = await astra<{ id: string }>('POST', `/api/sessions/${encodeURIComponent(conn.sessionId)}/messages/text`, { to: phone, text: 'Pronto! Você não vai mais receber nossas mensagens. 👍' }, { timeoutMs: 20_000 });
      await gravarMensagem(conv, { waId: r?.id, fromMe: true, text: 'Pronto! Você não vai mais receber nossas mensagens. 👍' });
    } catch { /* sem confirmação, o descadastro já valeu */ }
  }
}

function midiaMimeDoRaw(raw: any, tipo: string): string | null {
  const m = raw?.[`${tipo}Message`] || raw?.documentWithCaptionMessage?.message?.documentMessage;
  return m?.mimetype || ({ image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', sticker: 'image/webp' } as Record<string, string>)[tipo] || null;
}
function midiaNomeDoRaw(raw: any): string | null {
  const m = raw?.documentMessage || raw?.documentWithCaptionMessage?.message?.documentMessage;
  return m?.fileName || m?.title || null;
}

/** Recibo de entregue/lida das mensagens enviadas. */
export async function receberRecibo(conn: Conexao, d: any) {
  const ids: string[] = Array.isArray(d.ids) ? d.ids.map(String) : [];
  if (!ids.length) return;
  const tipo = String(d.type || '');
  const lida = tipo === 'read' || tipo === 'played' || tipo === 'read-self';
  const entregue = tipo === '' || tipo === 'delivered' || tipo === 'delivery';
  if (!lida && !entregue) return;
  const agora = new Date();
  if (lida) {
    await db.update(campaignTargets).set({ readAt: sql`coalesce(${campaignTargets.readAt}, ${agora.toISOString()}::timestamptz)`, deliveredAt: sql`coalesce(${campaignTargets.deliveredAt}, ${agora.toISOString()}::timestamptz)` }).where(inArray(campaignTargets.astraRef, ids));
    await db.update(messages).set({ status: 'read' }).where(and(inArray(messages.waId, ids), eq(messages.fromMe, true)));
  } else {
    await db.update(campaignTargets).set({ deliveredAt: sql`coalesce(${campaignTargets.deliveredAt}, ${agora.toISOString()}::timestamptz)` }).where(inArray(campaignTargets.astraRef, ids));
    await db.update(messages).set({ status: 'delivered' }).where(and(inArray(messages.waId, ids), eq(messages.fromMe, true), eq(messages.status, 'sent')));
  }
}

/** Voto numa enquete de campanha. */
export async function receberVoto(conn: Conexao, d: any) {
  const nomes: string[] = Array.isArray(d.selectedNames) ? d.selectedNames.map(String) : [];
  const phone = String(d.voterPhone || '').replace(/\D/g, '') || String(d.chat || '').split('@')[0].replace(/\D/g, '');
  if (!phone) return;
  const texto = nomes.length ? `📊 Votou: ${nomes.join(', ')}` : '📊 Retirou o voto';
  if (d.pollMessageId) {
    await db.update(campaignTargets).set({ reply: texto, repliedAt: sql`coalesce(${campaignTargets.repliedAt}, now())` }).where(eq(campaignTargets.astraRef, String(d.pollMessageId)));
  }
  const conv = await conversaDe(conn, phone);
  await gravarMensagem(conv, { waId: `vote-${d.pollMessageId}-${d.timestamp}`, fromMe: false, type: 'text', text: texto, at: d.timestamp ? new Date(Number(d.timestamp)) : undefined });
}
