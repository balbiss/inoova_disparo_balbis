import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, leadSearches } from '../db/schema.js';
import { normalizarTelefone } from './telefone.js';

// Extrator de leads do Google Maps. Usa o gosom/google-maps-scraper (open source, MIT) em modo web,
// rodando SÓ na rede interna (ele não tem senha): GMAPS_URL=http://gmaps:8080.
//   POST /api/v1/jobs            {name, keywords[], lang, depth, max_time(s), email, zoom}
//   GET  /api/v1/jobs/{id}       → { ID, Status: pending|working|ok|failed, … }
//   GET  /api/v1/jobs/{id}/download → CSV (title, category, address, website, phone, review_rating, …)
// A cada 15 s o servidor confere as buscas em andamento e, quando terminam, guarda os leads.

const URL_GMAPS = () => (process.env.GMAPS_URL || '').replace(/\/$/, '');
export const extratorConfigurado = () => !!URL_GMAPS();

async function gmaps<T = any>(metodo: string, caminho: string, corpo?: unknown, texto = false): Promise<T> {
  const r = await fetch(URL_GMAPS() + caminho, {
    method: metodo, signal: AbortSignal.timeout(60_000),
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = await r.text();
  if (!r.ok) {
    let msg = t.slice(0, 200);
    try { msg = JSON.parse(t).message || msg } catch { /* texto */ }
    throw Object.assign(new Error(msg || `erro ${r.status}`), { status: r.status });
  }
  return (texto ? t : t ? JSON.parse(t) : null) as T;
}

/** Quantos "rolagens" o extrator faz pra chegar perto da quantidade pedida (~12 por rolagem). */
const profundidade = (max: number) => Math.min(25, Math.max(1, Math.ceil(max / 12)));

export async function iniciarBusca(s: { id: number; query: string; location: string; maxResults: number; withEmail: boolean }) {
  const termo = s.location ? `${s.query} em ${s.location}` : s.query;
  const r = await gmaps<{ id: string }>('POST', '/api/v1/jobs', {
    name: `inoova-${s.id}`, keywords: [termo], lang: 'pt', zoom: 15, depth: profundidade(s.maxResults),
    email: s.withEmail, max_time: Math.min(1800, 180 + s.maxResults * (s.withEmail ? 6 : 3)),
  });
  await db.update(leadSearches).set({ jobId: r.id, status: 'working' }).where(eq(leadSearches.id, s.id));
}

/** CSV robusto (aspas, vírgulas e quebras de linha dentro dos campos). */
export function lerCsv(texto: string): Record<string, string>[] {
  const t = texto.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ',') { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(c => c !== '')) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some(c => c !== '')) linhas.push(linha);
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  return resto.map(l => Object.fromEntries(cab.map((c, i) => [c.trim(), l[i] ?? ''])));
}

/** Celular brasileiro: 55 + DDD + 9 + 8 dígitos (fixo raramente tem WhatsApp). */
export const ehCelular = (p: string | null) => !!p && /^55\d{2}9\d{8}$/.test(p);

export async function guardarResultado(searchId: number, csv: string) {
  const vistos = new Set<string>();
  const linhas = lerCsv(csv).map(r => {
    const raw = (r.phone || '').trim();
    const phone = raw ? normalizarTelefone(raw.startsWith('+') ? raw : raw.replace(/^0+/, '')) : null;
    return {
      searchId, name: (r.title || '').slice(0, 200), phone, phoneRaw: raw || null, mobile: ehCelular(phone),
      category: (r.category || '').slice(0, 120), address: textoEndereco(r.complete_address, r.address).slice(0, 300),
      website: (r.website || '').slice(0, 300), emails: (r.emails || '').slice(0, 500),
      rating: r.review_rating || null, reviewCount: Number(r.review_count) || null, link: (r.link || '').slice(0, 500),
    };
  }).filter(l => {
    // sem duplicar a mesma empresa/telefone na busca
    const k = l.phone || l.link || l.name;
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  await db.delete(leads).where(eq(leads.searchId, searchId));
  for (let i = 0; i < linhas.length; i += 500) await db.insert(leads).values(linhas.slice(i, i + 500));
  await db.update(leadSearches).set({ status: 'done', total: linhas.length, finishedAt: new Date(), error: null }).where(eq(leadSearches.id, searchId));
  return linhas.length;
}

let rodando = false;
async function acompanhar() {
  if (rodando || !extratorConfigurado()) return;
  rodando = true;
  try {
    const ativas = await db.select().from(leadSearches).where(inArray(leadSearches.status, ['pending', 'working']));
    for (const s of ativas) {
      try {
        if (!s.jobId) { await iniciarBusca(s); continue }
        const job = await gmaps<{ Status?: string; status?: string }>('GET', `/api/v1/jobs/${encodeURIComponent(s.jobId)}`);
        const st = String(job.Status || job.status || '').toLowerCase();
        if (st === 'ok') {
          const csv = await gmaps<string>('GET', `/api/v1/jobs/${encodeURIComponent(s.jobId)}/download`, undefined, true);
          await guardarResultado(s.id, csv);
          gmaps('DELETE', `/api/v1/jobs/${encodeURIComponent(s.jobId)}`).catch(() => {}); // libera espaço no extrator
        } else if (st === 'failed') {
          await db.update(leadSearches).set({ status: 'failed', error: 'O Google não devolveu resultados (pode ter bloqueado temporariamente). Tente de novo em alguns minutos.', finishedAt: new Date() }).where(eq(leadSearches.id, s.id));
        } else if (Date.now() - s.createdAt.getTime() > 40 * 60_000) {
          await db.update(leadSearches).set({ status: 'failed', error: 'A busca demorou demais e foi cancelada. Tente com menos resultados.', finishedAt: new Date() }).where(eq(leadSearches.id, s.id));
        }
      } catch (e) {
        if ((e as { status?: number }).status === 404 && s.jobId) {
          await db.update(leadSearches).set({ status: 'failed', error: 'A busca se perdeu no extrator (ele reiniciou). Faça de novo.', finishedAt: new Date() }).where(eq(leadSearches.id, s.id));
        } else console.warn('[leads]', s.id, (e as Error).message);
      }
    }
  } finally { rodando = false }
}

export function iniciarExtrator() {
  if (!extratorConfigurado()) { console.warn('[leads] GMAPS_URL não configurada — extrator de leads indisponível'); return }
  setInterval(() => void acompanhar(), 15_000);
  setTimeout(() => void acompanhar(), 3000);
}

export const leadsDaBusca = (searchId: number, ids?: number[]) =>
  db.select().from(leads).where(ids?.length ? and(eq(leads.searchId, searchId), inArray(leads.id, ids)) : eq(leads.searchId, searchId));

/** O gosom manda complete_address como JSON ({street, borough, city, state…}); vira texto legível. */
export function textoEndereco(completo?: string, simples?: string): string {
  const c = (completo || '').trim();
  if (c.startsWith('{')) {
    try {
      const j = JSON.parse(c) as Record<string, string>;
      const cidade = [j.city, j.state].filter(Boolean).join(' - ');
      const t = [j.street, j.borough, cidade].filter(Boolean).join(', ');
      if (t) return t;
    } catch { /* cai no simples */ }
    return (simples || '').trim();
  }
  return c || (simples || '').trim();
}
