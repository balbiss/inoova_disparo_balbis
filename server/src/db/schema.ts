import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Botão de campanha: quick_reply (resposta), cta_url (link), cta_call (ligar), cta_copy (copiar código). */
export type BotaoCampanha = { type: 'quick_reply' | 'cta_url' | 'cta_call' | 'cta_copy'; text: string; value?: string };

// Empresa cliente do SaaS (multi-empresa). O superadmin cria e define os limites.
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  maxConnections: integer('max_connections').notNull().default(1),
  maxContacts: integer('max_contacts').notNull().default(5000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// role: superadmin (dono do SaaS, sem empresa) | admin (gerencia a empresa) | user
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('users_email_uq').on(t.email)]);

// Número de WhatsApp da empresa = uma sessão no AstraCalls.
export const connections = pgTable('connections', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sessionId: text('session_id').notNull(),
  phone: text('phone'),
  // segredo do webhook do AstraCalls (assina as entregas com HMAC)
  webhookSecret: text('webhook_secret'),
  // saúde do número: restrição do WhatsApp (time-lock) e limite de conversas novas
  restrictionActive: boolean('restriction_active').notNull().default(false),
  restrictionEndsAt: timestamp('restriction_ends_at', { withTimezone: true }),
  cappingStatus: text('capping_status'),
  cappingRemaining: integer('capping_remaining'),
  cappingTotal: integer('capping_total'),
  healthAt: timestamp('health_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  // segurança anti-bloqueio (por NÚMERO, vale pra todas as campanhas dele)
  nextAt: timestamp('next_at', { withTimezone: true }),             // próximo envio liberado (intervalo sorteado)
  pausedUntil: timestamp('paused_until', { withTimezone: true }),   // pausa de segurança (longa / falhas seguidas)
  pauseReason: text('pause_reason'),
  sendsSincePause: integer('sends_since_pause').notNull().default(0),
  pauseEvery: integer('pause_every'),                               // N sorteado da próxima pausa longa
  warmupSince: timestamp('warmup_since', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('connections_tenant_idx').on(t.tenantId)]);

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#128C7E'),
}, t => [index('categories_tenant_idx').on(t.tenantId)]);

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull(),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  // descadastro: pediu pra não receber mais (botão "Não tenho interesse" ou mensagem SAIR)
  optOut: boolean('opt_out').notNull().default(false),
  optOutAt: timestamp('opt_out_at', { withTimezone: true }),
  // validação no WhatsApp: unknown | valid | invalid
  waStatus: text('wa_status').notNull().default('unknown'),
  waCheckedAt: timestamp('wa_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('contacts_tenant_phone_uq').on(t.tenantId, t.phone), index('contacts_category_idx').on(t.categoryId)]);

// kind: message | call
// status: draft | scheduled | running | paused | done | canceled
// messageType (kind=message): text | image | video | audio | document
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id').references(() => connections.id, { onDelete: 'set null' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('draft'),
  messageType: text('message_type').notNull().default('text'),
  text: text('text').notNull().default(''),
  mediaPath: text('media_path'),
  mediaName: text('media_name'),
  mediaMime: text('media_mime'),
  callVideo: boolean('call_video').notNull().default(false),
  maxRingSeconds: integer('max_ring_seconds').notNull().default(40),
  // versões extras do texto/legenda (anti-spam): cada contato recebe uma, em rodízio com o text principal
  textVariants: jsonb('text_variants').$type<string[]>().notNull().default([]),
  // botões (só em mensagem de texto), rodapé, enquete e opções anti-bloqueio
  buttons: jsonb('buttons').$type<BotaoCampanha[]>().notNull().default([]),
  optOutButton: boolean('opt_out_button').notNull().default(false),
  footer: text('footer').notNull().default(''),
  pollOptions: jsonb('poll_options').$type<string[]>().notNull().default([]),
  pollMulti: boolean('poll_multi').notNull().default(false),
  typing: boolean('typing').notNull().default(true),
  minDelay: integer('min_delay').notNull().default(20),
  maxDelay: integer('max_delay').notNull().default(45),
  pauseReason: text('pause_reason'),
  // segurança anti-bloqueio desta campanha (mesclada com o padrão/limites do admin)
  seguranca: jsonb('seguranca').$type<Record<string, unknown>>().notNull().default({}),
  // por que está parada agora mesmo "enviando" (fora do horário, número em pausa, limite do dia…)
  waitReason: text('wait_reason'),
  // agendamento: status 'scheduled' começa sozinho nessa hora
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  nextAt: timestamp('next_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('campaigns_tenant_idx').on(t.tenantId), index('campaigns_status_idx').on(t.status)]);

// status: pending | sending | sent | failed | skipped | ringing | answered | completed | no-answer
export const campaignTargets = pgTable('campaign_targets', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull(),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  // mensagem: id da mensagem no WhatsApp; ligação: id do disparo no AstraCalls
  astraRef: text('astra_ref'),
  durationMs: integer('duration_ms'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  reply: text('reply'),
  optedOut: boolean('opted_out').notNull().default(false),
  // ligação com "mensagem antes": status warming = mensagem enviada, esperando pra ligar
  preMsgId: text('pre_msg_id'),
  preSentAt: timestamp('pre_sent_at', { withTimezone: true }),
  callAfter: timestamp('call_after', { withTimezone: true }),
}, t => [index('targets_campaign_status_idx').on(t.campaignId, t.status), index('targets_astra_ref_idx').on(t.astraRef), index('targets_phone_idx').on(t.phone), index('targets_pre_msg_idx').on(t.preMsgId)]);

// Conversas: uma por número de WhatsApp da empresa + telefone do contato.
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  phone: text('phone').notNull(),
  name: text('name').notNull().default(''),
  lastCampaignId: integer('last_campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  lastPreview: text('last_preview').notNull().default(''),
  lastFromMe: boolean('last_from_me').notNull().default(true),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unread: integer('unread').notNull().default(0),
  // foto e nome do perfil no WhatsApp (atualizados a cada 12 h)
  avatarUrl: text('avatar_url'),
  waName: text('wa_name'),
  profileAt: timestamp('profile_at', { withTimezone: true }),
}, t => [uniqueIndex('conversations_conn_phone_uq').on(t.connectionId, t.phone), index('conversations_tenant_idx').on(t.tenantId, t.lastMessageAt)]);

// status (enviadas): sent | delivered | read | failed
// Configurações do sistema (superadmin): chave → JSON. Ex.: 'antiban' = padrões e limites de segurança.
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  waId: text('wa_id'),
  fromMe: boolean('from_me').notNull(),
  type: text('type').notNull().default('text'),
  text: text('text').notNull().default(''),
  mediaName: text('media_name'),
  mediaMime: text('media_mime'),
  mediaPath: text('media_path'),
  status: text('status'),
  campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  sentBy: integer('sent_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('messages_conv_wa_uq').on(t.conversationId, t.waId), index('messages_wa_idx').on(t.waId), index('messages_conv_idx').on(t.conversationId, t.createdAt)]);
