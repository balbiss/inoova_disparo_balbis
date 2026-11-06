import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
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

// --- telefone com ou sem o 9º dígito ------------------------------------------------------------
// O WhatsApp às vezes registra celular BR SEM o 9 (55 91 8293-5558) e a lista tem COM o 9
// (55 91 9 8293-5558). A "chave" ignora isso: DDI+DDD + últimos 8 dígitos (igual InoovaCall).
export const chaveTelefone = (t: string) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d.slice(0, 4) + d.slice(-8) : d;
};
/** Mesma chave em SQL, pra comparar uma coluna de telefone. */
export const chaveSql = (col: unknown) => sql`(case when ${col} like '55%' and length(${col}) >= 12 then left(${col}, 4) || right(${col}, 8) else ${col} end)`;
export const mesmoTelefone = (col: unknown, phone: string) => sql`${chaveSql(col)} = ${chaveTelefone(phone)}`;

/** Acha/cria a conversa do telefone naquele número da empresa (com ou sem o 9). */
export async function conversaDe(conn: Conexao, phone: string, nome = '') {
  const [ja] = await db.select().from(conversations).where(and(eq(conversations.connectionId, conn.id), mesmoTelefone(conversations.phone, phone))).orderBy(conversations.id).limit(1);
  if (ja) {
    if (nome && !ja.name) await db.update(conversations).set({ name: nome }).where(eq(conversations.id, ja.id));
    return ja;
  }
  const [contato] = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone }).from(contacts).where(and(eq(contacts.tenantId, conn.tenantId), mesmoTelefone(contacts.phone, phone))).limit(1);
  // guarda o telefone como está na lista de contatos (com o 9), pra bater com a campanha
  const tel = contato?.phone || phone;
  const [nova] = await db.insert(conversations).values({
    tenantId: conn.tenantId, connectionId: conn.id, phone: tel, contactId: contato?.id ?? null, name: contato?.name || nome || '',
  }).onConflictDoNothing().returning();
  if (nova) return nova;
  const [c] = await db.select().from(conversations).where(and(eq(conversations.connectionId, conn.id), mesmoTelefone(conversations.phone, phone))).limit(1);
  return c;
}

/** Junta conversas duplicadas do mesmo telefone (com/sem 9) — roda ao subir o servidor. */
export async function juntarConversasDuplicadas() {
  const grupos = await db.execute(sql`
    select connection_id, ${chaveSql(sql.raw('phone'))} as chave, array_agg(id order by (contact_id is null), id) as ids
      from conversations group by connection_id, chave having count(*) > 1`) as unknown as { ids: number[] }[];
  for (const g of grupos) {
    const [fica, ...sai] = g.ids.map(Number);
    for (const id of sai) {
      // mensagem que já existe na conversa que fica (mesmo id do WhatsApp) é descartada
      await db.execute(sql`delete from messages m where m.conversation_id = ${id} and m.wa_id is not null
                           and exists (select 1 from messages x where x.conversation_id = ${fica} and x.wa_id = m.wa_id)`);
      await db.update(messages).set({ conversationId: fica }).where(eq(messages.conversationId, id));
      const [velha] = await db.select().from(conversations).where(eq(conversations.id, id));
      await db.execute(sql`update conversations c set
          unread = c.unread + ${velha.unread},
          last_inbound_at = greatest(c.last_inbound_at, ${velha.lastInboundAt?.toISOString() ?? null}::timestamptz),
          name = case when c.name = '' then ${velha.name} else c.name end,
          contact_id = coalesce(c.contact_id, ${velha.contactId}),
          last_campaign_id = coalesce(c.last_campaign_id, ${velha.lastCampaignId})
        where c.id = ${fica}`);
      await db.delete(conversations).where(eq(conversations.id, id));
    }
    // prévia/hora da última mensagem depois de juntar
    await db.execute(sql`update conversations c set last_message_at = m.created_at, last_preview = left(coalesce(nullif(m.text, ''), 'Mensagem'), 140), last_from_me = m.from_me
      from (select created_at, text, from_me from messages where conversation_id = ${fica} order by created_at desc, id desc limit 1) m where c.id = ${fica}`);
  }
  if (grupos.length) console.log(`[conversas] ${grupos.length} conversa(s) duplicada(s) juntada(s)`);
}

// --- foto e nome do perfil ----------------------------------------------------------------------
const nomesPorSessao = new Map<string, { at: number; mapa: Map<string, string> }>();
async function nomeNoWhatsapp(sessionId: string, phone: string) {
  let c = nomesPorSessao.get(sessionId);
  if (!c || Date.now() - c.at > 10 * 60_000) {
    const mapa = new Map<string, string>();
    try {
      const r = await astra<any>('GET', `/api/sessions/${encodeURIComponent(sessionId)}/contacts`, undefined, { timeoutMs: 20_000 });
      const lista: any[] = Array.isArray(r) ? r : r?.contacts || [];
      for (const x of lista) {
        const tel = String(x.phone || x.number || '').replace(/\D/g, '');
        const nome = String(x.pushName || x.pushname || x.fullName || x.businessName || x.name || '').trim();
        if (tel && nome) mapa.set(chaveTelefone(tel), nome);
      }
    } catch { /* sem nomes agora */ }
    c = { at: Date.now(), mapa };
    nomesPorSessao.set(sessionId, c);
  }
  return c.mapa.get(chaveTelefone(phone)) || null;
}

/** Busca a foto do perfil e o nome no WhatsApp (no máximo a cada 12 h por conversa). */
export async function atualizarPerfil(conv: typeof conversations.$inferSelect, forcar = false) {
  if (!forcar && conv.profileAt && Date.now() - conv.profileAt.getTime() < 12 * 3600_000) return conv;
  const [conn] = await db.select().from(connections).where(eq(connections.id, conv.connectionId));
  if (!conn) return conv;
  let avatarUrl: string | null = conv.avatarUrl;
  try {
    const r = await astra<{ url?: string }>('GET', `/api/sessions/${encodeURIComponent(conn.sessionId)}/contacts/${conv.phone}/picture?preview=true`, undefined, { timeoutMs: 15_000 });
    avatarUrl = r?.url || null;
  } catch (e) {
    if ((e as { status?: number }).status === 503) return conv; // número desconectado: tenta depois
  }
  const waName = (await nomeNoWhatsapp(conn.sessionId, conv.phone)) || conv.waName;
  const [novo] = await db.update(conversations).set({ avatarUrl, waName, profileAt: new Date(), ...(!conv.name && waName ? { name: waName } : {}) })
    .where(eq(conversations.id, conv.id)).returning();
  return novo ?? conv;
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
    .where(and(eq(campaigns.tenantId, tenantId), mesmoTelefone(campaignTargets.phone, phone), inArray(campaignTargets.status, ['sent', 'completed', 'no-answer', 'answered', 'warming', 'ringing']), sql`coalesce(${campaignTargets.doneAt}, ${campaignTargets.preSentAt}) >= now() - interval '30 days'`))
    .orderBy(desc(sql`coalesce(${campaignTargets.doneAt}, ${campaignTargets.preSentAt})`)).limit(1);
  return a;
}

/** Marca o contato como descadastrado (cria o contato se ainda não existir, pra ficar bloqueado). */
export async function descadastrar(tenantId: number, phone: string, nome = '') {
  const [ja] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), mesmoTelefone(contacts.phone, phone))).limit(1);
  if (ja) { await db.update(contacts).set({ optOut: true, optOutAt: new Date() }).where(eq(contacts.id, ja.id)); return }
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
    await db.update(campaignTargets).set({ readAt: sql`coalesce(${campaignTargets.readAt}, ${agora.toISOString()}::timestamptz)`, deliveredAt: sql`coalesce(${campaignTargets.deliveredAt}, ${agora.toISOString()}::timestamptz)` }).where(or(inArray(campaignTargets.astraRef, ids), inArray(campaignTargets.preMsgId, ids)));
    await db.update(messages).set({ status: 'read' }).where(and(inArray(messages.waId, ids), eq(messages.fromMe, true)));
  } else {
    await db.update(campaignTargets).set({ deliveredAt: sql`coalesce(${campaignTargets.deliveredAt}, ${agora.toISOString()}::timestamptz)` }).where(or(inArray(campaignTargets.astraRef, ids), inArray(campaignTargets.preMsgId, ids)));
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
