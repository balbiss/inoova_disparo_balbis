// Cliente do AstraCalls. Só o servidor fala com ele (a chave-mestra nunca vai pro navegador).
// Cada número de WhatsApp de uma empresa é uma sessão no AstraCalls; o QR e o estado da conexão
// chegam pelo SSE /api/events e ficam guardados em memória (estadoSessao).

const URL_ASTRA = () => (process.env.ASTRACALLS_URL || '').replace(/\/$/, '');
const CHAVE = () => process.env.ASTRACALLS_API_KEY || '';
export const astraConfigurado = () => !!(URL_ASTRA() && CHAVE());

export class AstraErro extends Error {
  constructor(msg: string, public status: number) { super(msg) }
}

type Opts = { clientId?: string; timeoutMs?: number; headers?: Record<string, string> };

export async function astra<T = any>(metodo: string, caminho: string, corpo?: unknown, opts: Opts = {}): Promise<T> {
  if (!astraConfigurado()) throw new AstraErro('AstraCalls não configurado no servidor (ASTRACALLS_URL / ASTRACALLS_API_KEY).', 503);
  let r: Response;
  try {
    r = await fetch(URL_ASTRA() + caminho, {
      method: metodo,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      headers: { 'X-API-Key': CHAVE(), 'Content-Type': 'application/json', ...(opts.clientId ? { 'X-Client-Id': opts.clientId } : {}), ...opts.headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (e) {
    throw new AstraErro('AstraCalls não respondeu: ' + (e as Error).message, 502);
  }
  const txt = await r.text();
  let j: any = null;
  try { j = txt ? JSON.parse(txt) : null } catch { /* sem JSON */ }
  if (!r.ok) throw new AstraErro(j?.error || txt.slice(0, 200) || `erro ${r.status}`, r.status);
  return j as T;
}

export const clientIdDe = (tenantId: number) => `disparo_t${tenantId}`;

// --- estado das sessões (SSE) -------------------------------------------------------------------
export type EstadoSessao = { state: string; paired: boolean; jid?: string; qr?: string; at: number };
export const estadoSessao = new Map<string, EstadoSessao>();

function tratar(ev: any) {
  if (!ev?.type) return;
  const sid = ev.sessionId;
  const atual = sid ? estadoSessao.get(sid) : undefined;
  if (ev.type === 'session-qr' && sid) {
    estadoSessao.set(sid, { ...atual, state: 'qr', paired: false, qr: ev.qr, at: Date.now() });
  } else if (ev.type === 'auth-state' && sid) {
    estadoSessao.set(sid, { ...atual, state: ev.state || atual?.state || '', paired: !!ev.paired, jid: ev.jid || atual?.jid, qr: ev.paired ? undefined : (ev.qr || atual?.qr), at: Date.now() });
  } else if (ev.type === 'session-list' && Array.isArray(ev.sessions)) {
    for (const s of ev.sessions) {
      const a = estadoSessao.get(s.id);
      estadoSessao.set(s.id, { state: s.state, paired: !!s.paired, jid: s.jid || s.lastJid || a?.jid, qr: s.paired ? undefined : a?.qr, at: Date.now() });
    }
  }
}

export function iniciarEventosAstra() {
  if (!astraConfigurado()) { console.warn('[astra] não configurado — conexões e disparos ficam indisponíveis'); return }
  void (async () => {
    for (;;) {
      try {
        const r = await fetch(`${URL_ASTRA()}/api/events?apiKey=${encodeURIComponent(CHAVE())}`, { headers: { Accept: 'text/event-stream' } });
        if (!r.ok || !r.body) throw new Error('sse ' + r.status);
        const leitor = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const linha = buf.slice(0, i).split('\n').find(l => l.startsWith('data:'));
            buf = buf.slice(i + 2);
            if (!linha) continue;
            try { tratar(JSON.parse(linha.slice(5).trim())) } catch { /* evento sem JSON */ }
          }
        }
      } catch { /* AstraCalls fora do ar: tenta de novo */ }
      await new Promise(r => setTimeout(r, 3000));
    }
  })();
}

/** Estado atual de uma sessão: usa o SSE e, se não tiver nada recente, pergunta à API. */
export async function estadoDe(sessionId: string, forcar = false): Promise<EstadoSessao | null> {
  const ev = estadoSessao.get(sessionId);
  if (!forcar && ev && Date.now() - ev.at < 15_000) return ev;
  try {
    const { sessions } = await astra<{ sessions: any[] }>('GET', '/api/sessions', undefined, { timeoutMs: 15_000 });
    for (const s of sessions) {
      const a = estadoSessao.get(s.id);
      estadoSessao.set(s.id, { state: s.state, paired: !!s.paired, jid: s.jid || s.lastJid || a?.jid, qr: s.paired ? undefined : a?.qr, at: Date.now() });
    }
    return estadoSessao.get(sessionId) ?? null;
  } catch {
    return ev ?? null;
  }
}

export const numeroDoJid = (jid?: string | null) => (jid ? String(jid).split(/[:@]/)[0] : null);
