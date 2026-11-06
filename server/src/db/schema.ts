import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('contacts_tenant_phone_uq').on(t.tenantId, t.phone), index('contacts_category_idx').on(t.categoryId)]);

// kind: message | call
// status: draft | running | paused | done | canceled
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
  minDelay: integer('min_delay').notNull().default(20),
  maxDelay: integer('max_delay').notNull().default(45),
  pauseReason: text('pause_reason'),
  nextAt: timestamp('next_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('campaigns_tenant_idx').on(t.tenantId), index('campaigns_status_idx').on(t.status)]);

// status: pending | sending | sent | failed | ringing | answered | completed | no-answer
export const campaignTargets = pgTable('campaign_targets', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull(),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  astraRef: text('astra_ref'),
  durationMs: integer('duration_ms'),
  doneAt: timestamp('done_at', { withTimezone: true }),
}, t => [index('targets_campaign_status_idx').on(t.campaignId, t.status)]);
