import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Loader2, MapPin, Search, Smartphone, Sparkles, Star, Trash2, UserPlus, AlertTriangle } from 'lucide-react';
import { api, baixar, confirmar, erro, fmtData, fmtNum, fmtTel, ok } from '../lib/api';
import { Cabecalho, Carregando, Vazio, btn, inputStyle } from '../components/ui';

type Busca = { id: number; query: string; location: string; maxResults: number; withEmail: boolean; status: 'pending' | 'working' | 'done' | 'failed'; total: number; error: string | null; createdAt: string; finishedAt: string | null; comTelefone?: number; celulares?: number };
type Lead = { id: number; name: string; phone: string | null; phoneRaw: string | null; mobile: boolean; category: string; address: string; website: string; emails: string; rating: string | null; reviewCount: number | null; link: string; imported: boolean };
type Categoria = { id: number; name: string };

const QTDS = [20, 50, 100, 200, 500];

function Situacao({ b }: { b: Busca }) {
  if (b.status === 'done') return <span style={tag('var(--verde-escuro)', 'var(--verde-soft)')}>{fmtNum(b.total)} encontrados</span>;
  if (b.status === 'failed') return <span style={tag('#C42B30', '#FDECEC')}>Falhou</span>;
  return <span style={tag('#1D5FC2', '#EAF2FE')}><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Buscando…</span>;
}
const tag = (c: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, background: bg, color: c, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' });

/** Extrator de leads do Google Maps: busca empresas por tipo + cidade e salva nos contatos. */
export default function Leads() {
  const [buscas, setBuscas] = useState<Busca[] | null>(null);
  const [configurado, setConfigurado] = useState(true);
  const [o, setO] = useState('');
  const [onde, setOnde] = useState('');
  const [qtd, setQtd] = useState(50);
  const [emails, setEmails] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const carregar = useCallback(() => api<{ configurado: boolean; searches: Busca[] }>('GET', '/lead-searches').then(r => { setBuscas(r.searches); setConfigurado(r.configurado) }).catch(erro), []);
  useEffect(() => { carregar() }, [carregar]);
  const ativa = buscas?.some(b => b.status === 'pending' || b.status === 'working');
  useEffect(() => { if (!ativa) return; const t = setInterval(carregar, 4000); return () => clearInterval(t) }, [ativa, carregar]);
  useEffect(() => { if (buscas?.length && aberta === null) setAberta(buscas[0].id) }, [buscas, aberta]);

  const buscar = async () => {
    if (o.trim().length < 2) return erro('Diga o que procurar (ex.: pizzaria, loja de móveis, dentista).');
    setBuscando(true);
    try {
      const r = await api<{ search: Busca }>('POST', '/lead-searches', { query: o.trim(), location: onde.trim(), maxResults: qtd, withEmail: emails });
      ok('Busca iniciada! Leva alguns minutos; pode continuar usando o sistema.');
      setAberta(r.search.id); carregar();
    } catch (e) { erro(e) } finally { setBuscando(false) }
  };

  if (!buscas) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Extrator de leads" />
      <p style={{ margin: '-8px 0 16px', fontSize: 14, color: 'var(--muted)', maxWidth: 820, lineHeight: 1.55 }}>Encontre empresas no Google Maps pelo tipo de negócio e cidade, com telefone, site e avaliação. Depois é só salvar nos contatos e criar a campanha.</p>

      {!configurado && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', background: '#FFF8E6', border: '1px solid #F7E2B0', borderRadius: 12, fontSize: 14, marginBottom: 16 }}>
          <AlertTriangle size={18} color="#B7791F" /> O extrator ainda não foi ligado no servidor. Fale com o suporte.
        </div>
      )}

      <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: '0 1px 2px rgba(11,20,26,.04)' }}>
        <div className="form-leads" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) 150px auto', gap: 10, alignItems: 'end' }}>
          <label><span style={rot}>O que você procura?</span>
            <div style={{ position: 'relative' }}><Search size={16} color="var(--muted)" style={{ position: 'absolute', left: 11, top: 12 }} />
              <input style={{ ...inputStyle, paddingLeft: 34, height: 40 }} value={o} onChange={e => setO(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} placeholder="Ex.: loja de móveis, dentista, academia" maxLength={120} /></div>
          </label>
          <label><span style={rot}>Onde?</span>
            <div style={{ position: 'relative' }}><MapPin size={16} color="var(--muted)" style={{ position: 'absolute', left: 11, top: 12 }} />
              <input style={{ ...inputStyle, paddingLeft: 34, height: 40 }} value={onde} onChange={e => setOnde(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} placeholder="Cidade, bairro ou estado" maxLength={120} /></div>
          </label>
          <label><span style={rot}>Quantos?</span>
            <select style={{ ...inputStyle, height: 40 }} value={qtd} onChange={e => setQtd(Number(e.target.value))}>{QTDS.map(n => <option key={n} value={n}>até {n}</option>)}</select>
          </label>
          <button style={btn('primary', { height: 40, padding: '0 20px' })} disabled={buscando || !!ativa || !configurado} onClick={buscar} title={ativa ? 'Espere a busca atual terminar' : undefined}>
            {buscando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={16} />} Buscar
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginTop: 12, color: 'var(--muted)' }}>
          <input type="checkbox" checked={emails} onChange={e => setEmails(e.target.checked)} /> Buscar também os e-mails nos sites das empresas (demora mais)
        </label>
      </section>

      {buscas.length === 0 ? (
        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14 }}>
          <Vazio icone={<Sparkles size={26} />} titulo="Faça sua primeira busca" texto="Exemplo: “pet shop” em “Belém, PA”. A lista aparece aqui em poucos minutos." />
        </section>
      ) : (
        <div className="grid-leads" style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>Suas buscas</div>
            {buscas.map(b => (
              <button key={b.id} onClick={() => setAberta(b.id)} style={{ width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: aberta === b.id ? 'var(--verde-soft)' : 'var(--card)', boxShadow: aberta === b.id ? 'inset 3px 0 0 var(--verde)' : undefined }}>
                <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.query}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.location || 'Sem local'} · {fmtData(b.createdAt)}</div>
                <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}><Situacao b={b} />{b.status === 'done' && !!b.celulares && <span style={tag('#54656F', '#EEF1F2')}>{b.celulares} celulares</span>}</div>
              </button>
            ))}
          </section>
          {aberta && <Resultado key={aberta} id={aberta} onMudou={carregar} onApagada={() => { setAberta(null); carregar() }} />}
        </div>
      )}
    </>
  );
}

function Resultado({ id, onMudou, onApagada }: { id: number; onMudou: () => void; onApagada: () => void }) {
  const [dados, setDados] = useState<{ search: Busca; leads: Lead[] } | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'telefone' | 'celular'>('celular');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cats, setCats] = useState<Categoria[]>([]);
  const [destino, setDestino] = useState('nova');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => api<{ search: Busca; leads: Lead[] }>('GET', `/lead-searches/${id}`).then(setDados).catch(erro), [id]);
  useEffect(() => { carregar(); api<{ categories: Categoria[] }>('GET', '/contacts/categories').then(r => setCats(r.categories)).catch(() => {}) }, [carregar]);
  const andamento = dados && (dados.search.status === 'pending' || dados.search.status === 'working');
  useEffect(() => { if (!andamento) return; const t = setInterval(() => { carregar(); onMudou() }, 4000); return () => clearInterval(t) }, [andamento, carregar, onMudou]);

  const visiveis = useMemo(() => (dados?.leads || []).filter(l => filtro === 'todos' || (filtro === 'telefone' ? !!l.phone : l.mobile)), [dados, filtro]);
  if (!dados) return <Carregando />;
  const { search: s, leads } = dados;
  const comTel = leads.filter(l => l.phone).length, cel = leads.filter(l => l.mobile).length;
  const alvo = sel.size ? visiveis.filter(l => sel.has(l.id)) : visiveis;
  const salvaveis = alvo.filter(l => l.phone).length;
  const nomeCategoria = `${s.query}${s.location ? ' - ' + s.location : ''}`.slice(0, 60);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await api<{ created: number; updated: number }>('POST', `/lead-searches/${id}/import`, {
        leadIds: alvo.map(l => l.id), somenteCelular: filtro === 'celular' && !sel.size,
        ...(destino === 'nova' ? { newCategory: nomeCategoria } : destino === 'nenhuma' ? {} : { categoryId: Number(destino) }),
      });
      ok(`${fmtNum(r.created)} contato(s) salvo(s)${r.updated ? `, ${fmtNum(r.updated)} já existia(m)` : ''}. Agora é só criar a campanha!`);
      setSel(new Set()); carregar(); onMudou();
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };
  const apagar = async () => {
    if (!(await confirmar('Apagar esta busca?', 'Os contatos que você já salvou continuam na sua lista.', 'Apagar', true))) return;
    try { await api('DELETE', `/lead-searches/${id}`); onApagada() } catch (e) { erro(e) }
  };
  const chip = (v: typeof filtro, label: string, n: number) => (
    <button onClick={() => { setFiltro(v); setSel(new Set()) }} style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${filtro === v ? 'var(--verde)' : 'var(--line)'}`, background: filtro === v ? 'var(--verde-soft)' : 'var(--card)', color: filtro === v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 13, fontWeight: 700 }}>{label} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{n}</span></button>
  );
  const todosSel = visiveis.length > 0 && visiveis.every(l => sel.has(l.id));

  return (
    <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{s.query}{s.location && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> em {s.location}</span>}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Buscado em {fmtData(s.createdAt)} · até {s.maxResults} resultados{s.withEmail ? ' · com e-mails' : ''}</div>
        </div>
        {s.status === 'done' && <button style={btn('ghost', { minHeight: 34 })} onClick={() => baixar(`/lead-searches/${id}/export`, `leads-${id}.csv`)}><Download size={15} /> Planilha</button>}
        {!andamento && <button style={btn('ghost', { minHeight: 34, padding: '0 10px' })} title="Apagar busca" onClick={apagar}><Trash2 size={15} color="var(--perigo)" /></button>}
      </div>

      {andamento ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
          <Loader2 size={30} color="var(--verde)" style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 16, margin: '14px 0 6px' }}>Procurando empresas no Google Maps…</p>
          <p style={{ margin: 0, fontSize: 14 }}>Isso leva de 1 a {Math.max(3, Math.ceil(s.maxResults / 25))} minutos. Pode sair desta tela; a busca continua.</p>
        </div>
      ) : s.status === 'failed' ? (
        <div style={{ padding: 24, display: 'flex', gap: 10, color: '#C42B30', fontSize: 14 }}><AlertTriangle size={18} /> {s.error || 'A busca falhou. Tente de novo.'}</div>
      ) : leads.length === 0 ? (
        <Vazio icone={<Search size={24} />} titulo="Nenhuma empresa encontrada" texto="Tente outro termo ou uma cidade maior." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            {chip('celular', 'Só celular', cel)}{chip('telefone', 'Com telefone', comTel)}{chip('todos', 'Todos', leads.length)}
            <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 6 }}>Celular tem mais chance de ter WhatsApp.</span>
          </div>
          <div className="tabela-wrap" style={{ maxHeight: 'calc(100dvh - 430px)', minHeight: 260, overflowY: 'auto' }}>
            <table className="tabela">
              <thead><tr>
                <th style={{ width: 34 }}><input type="checkbox" aria-label="Marcar todos" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(visiveis.map(l => l.id)))} /></th>
                <th>Empresa</th><th>Telefone</th><th className="esconde-mobile">Nota</th><th className="esconde-mobile">Site / endereço</th>
              </tr></thead>
              <tbody>
                {visiveis.map(l => (
                  <tr key={l.id}>
                    <td><input type="checkbox" aria-label={`Marcar ${l.name}`} checked={sel.has(l.id)} onChange={() => setSel(x => { const n = new Set(x); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n })} /></td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{l.name} {l.imported && <span style={{ ...tag('var(--verde-escuro)', 'var(--verde-soft)'), marginLeft: 4 }}>Salvo</span>}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{l.category}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.phone ? <>{fmtTel(l.phone)}{l.mobile && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--verde-escuro)', fontWeight: 700, marginLeft: 6 }}><Smartphone size={12} />celular</div>}</> : <span style={{ color: 'var(--muted)' }}>{l.phoneRaw || 'Sem telefone'}</span>}
                    </td>
                    <td className="esconde-mobile" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{l.rating ? <><Star size={13} color="#F5A524" fill="#F5A524" style={{ verticalAlign: -2 }} /> {l.rating.replace('.', ',')} <span style={{ color: 'var(--muted)' }}>({l.reviewCount ?? 0})</span></> : '—'}</td>
                    <td className="esconde-mobile" style={{ fontSize: 12.5, maxWidth: 320 }}>
                      {l.website && <a href={l.website} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{l.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)} <ExternalLink size={11} /></a>}
                      <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.address}</div>
                      {l.emails && <div style={{ color: 'var(--muted)' }}>✉ {l.emails}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px', background: '#111B21', color: '#fff' }}>
            <span style={{ flex: '1 1 200px', fontSize: 14 }}>{sel.size ? <><b>{sel.size}</b> marcado(s)</> : <>Todos os <b>{fmtNum(visiveis.length)}</b> da lista</>} · <b>{fmtNum(salvaveis)}</b> com telefone</span>
            <select value={destino} onChange={e => setDestino(e.target.value)} aria-label="Categoria" style={{ ...inputStyle, width: 'auto', minWidth: 230, background: '#fff', color: '#111B21' }}>
              <option value="nova">Nova categoria “{nomeCategoria}”</option>
              <option value="nenhuma">Sem categoria</option>
              {cats.map(c => <option key={c.id} value={c.id}>Na categoria “{c.name}”</option>)}
            </select>
            <button style={btn('primary', { background: '#25D366', color: '#073B33' })} disabled={salvando || !salvaveis} onClick={salvar}><UserPlus size={15} /> {salvando ? 'Salvando…' : 'Salvar nos contatos'}</button>
            <Link to="/campanhas/nova" style={{ color: '#9FE7C2', fontSize: 13, fontWeight: 700 }}>Criar campanha →</Link>
          </div>
        </>
      )}
    </section>
  );
}

const rot: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 };
