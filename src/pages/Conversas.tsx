import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, CheckCheck, Clock, FileText, Loader2, MessageCircle, Mic, Paperclip, PhoneCall, Search, Send, ShieldCheck, X } from 'lucide-react';
import { api, confirmar, erro, fmtTel, getToken, ok } from '../lib/api';
import { Carregando, Pilula, btn, inputStyle } from '../components/ui';
import { Avatar } from '../components/Avatar';

type Resumo = { id: number; phone: string; name: string; avatarUrl: string | null; waName: string | null; lastMessageAt: string; lastPreview: string; lastFromMe: boolean; unread: number; connectionName: string | null; campaignName: string | null; optOut: boolean };
type Detalhe = { id: number; phone: string; name: string; avatarUrl: string | null; waName: string | null; unread: number; connectionName: string; contactId: number | null; optOut: boolean; campaign: { id: number; name: string } | null };
type Msg = { id: number; fromMe: boolean; type: string; text: string; mediaName: string | null; mediaMime: string | null; hasMedia: boolean; status: string | null; createdAt: string; campaignId: number | null; sentByName: string | null };

const hora = (d: string) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function quando(d: string) {
  const dt = new Date(d), hoje = new Date();
  if (dt.toDateString() === hoje.toDateString()) return hora(d);
  const ontem = new Date(Date.now() - 86400_000);
  if (dt.toDateString() === ontem.toDateString()) return 'Ontem';
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
const diaLabel = (d: string) => {
  const dt = new Date(d), hoje = new Date();
  if (dt.toDateString() === hoje.toDateString()) return 'Hoje';
  if (dt.toDateString() === new Date(Date.now() - 86400_000).toDateString()) return 'Ontem';
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) com o texto escapado antes. */
function formatar(t: string) {
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function Tiques({ status }: { status: string | null }) {
  if (status === 'read') return <CheckCheck size={15} color="#53BDEB" />;
  if (status === 'delivered') return <CheckCheck size={15} color="#8696A0" />;
  if (status === 'failed') return <X size={14} color="var(--perigo)" />;
  if (status === 'sent') return <Check size={15} color="#8696A0" />;
  return <Clock size={13} color="#8696A0" />;
}

/** Mídia carregada com o token (imagem/figurinha aparece sozinha; o resto sob demanda). */
function Midia({ m }: { m: Msg }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const auto = m.type === 'image' || m.type === 'sticker';
  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/conversations/messages/${m.id}/media`, { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!r.ok) throw new Error();
      setUrl(URL.createObjectURL(await r.blob()));
    } catch { setFalhou(true) } finally { setCarregando(false) }
  }, [m.id]);
  useEffect(() => { if (auto) carregar() }, [auto, carregar]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url]);

  if (falhou) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '6px 4px' }}>Mídia indisponível</div>;
  if (!url) {
    if (carregando || auto) return <div style={{ width: 220, height: auto ? 160 : 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.05)', borderRadius: 6 }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /></div>;
    const icone = m.type === 'audio' ? <Mic size={18} /> : m.type === 'video' ? <PhoneCall size={18} /> : <FileText size={18} />;
    return (
      <button onClick={carregar} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.05)', fontSize: 13, minWidth: 200, textAlign: 'left' }}>
        {icone} <span style={{ flex: 1 }}>{m.type === 'audio' ? 'Ouvir áudio' : m.type === 'video' ? 'Ver vídeo' : (m.mediaName || 'Abrir documento')}</span>
      </button>
    );
  }
  if (m.type === 'image') return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ maxWidth: 280, maxHeight: 320, borderRadius: 6, display: 'block' }} /></a>;
  if (m.type === 'sticker') return <img src={url} alt="Figurinha" style={{ width: 130, height: 130, objectFit: 'contain' }} />;
  if (m.type === 'audio') return <audio src={url} controls autoPlay style={{ width: 250, maxWidth: '100%' }} />;
  if (m.type === 'video') return <video src={url} controls autoPlay style={{ maxWidth: 280, borderRadius: 6 }} />;
  return <a href={url} download={m.mediaName || 'arquivo'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,.05)', fontSize: 13 }}><FileText size={18} /> {m.mediaName || 'Baixar arquivo'}</a>;
}

export default function Conversas() {
  const [params, setParams] = useSearchParams();
  const aberta = Number(params.get('c')) || null;
  const [filtro, setFiltro] = useState<'respondidas' | 'nao_lidas' | 'todas'>('todas');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Resumo[] | null>(null);
  const [total, setTotal] = useState(0);

  const carregarLista = useCallback(() => {
    const p = new URLSearchParams({ filter: filtro, per: '80' });
    if (q.trim()) p.set('q', q.trim());
    return api<{ conversations: Resumo[]; total: number }>('GET', '/conversations?' + p).then(r => { setLista(r.conversations); setTotal(r.total) }).catch(erro);
  }, [filtro, q]);

  useEffect(() => {
    const t0 = setTimeout(carregarLista, q ? 300 : 0);
    const t = setInterval(carregarLista, 5000);
    return () => { clearTimeout(t0); clearInterval(t) };
  }, [carregarLista, q]);

  const abrir = (id: number | null) => setParams(id ? { c: String(id) } : {});

  const chip = (v: typeof filtro, label: string) => (
    <button onClick={() => setFiltro(v)} style={{ padding: '5px 11px', borderRadius: 99, border: `1px solid ${filtro === v ? 'var(--verde)' : 'var(--line)'}`, background: filtro === v ? 'var(--verde-soft)' : 'var(--card)', color: filtro === v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 12.5, fontWeight: 700 }}>{label}</button>
  );

  return (
    <div className={'conversas' + (aberta ? ' com-chat' : '')} style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', height: 'calc(100dvh - 60px - 28px)', minHeight: 420, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
      <aside className="conv-lista" style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%' }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <h1 style={{ fontSize: 18, margin: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>Conversas</h1>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{total}</span>
          </div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={15} color="var(--muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
            <input style={{ ...inputStyle, paddingLeft: 32, background: 'var(--card-2)', border: '1px solid transparent' }} placeholder="Buscar nome ou telefone" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{chip('todas', 'Todas')}{chip('nao_lidas', 'Não lidas')}{chip('respondidas', 'Responderam')}</div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!lista ? <Carregando /> : lista.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
              {filtro === 'respondidas' ? 'Ninguém respondeu ainda. Quando um contato responder uma campanha, a conversa aparece aqui.' : filtro === 'nao_lidas' ? 'Nenhuma conversa não lida.' : 'Nenhuma conversa ainda.'}
            </div>
          ) : lista.map(c => (
            <button key={c.id} onClick={() => abrir(c.id)} style={{ width: '100%', display: 'flex', gap: 11, padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: c.id === aberta ? '#F0F2F5' : 'var(--card)', textAlign: 'left', alignItems: 'center' }}>
              <Avatar url={c.avatarUrl} nome={c.name || c.waName || ''} apagado={c.optOut} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.waName || fmtTel(c.phone)}{!c.name && c.waName && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12.5 }}> · {fmtTel(c.phone)}</span>}</span>
                  <span style={{ fontSize: 12, color: c.unread ? 'var(--verde)' : 'var(--muted)', fontWeight: c.unread ? 700 : 400 }}>{quando(c.lastMessageAt)}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastFromMe && '✓ '}{c.lastPreview}</span>
                  {c.unread > 0 && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 99, background: 'var(--verde)', color: '#fff', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.unread}</span>}
                </span>
                {(c.campaignName || c.optOut) && (
                  <span style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {c.optOut && <Pilula cor="vermelho">Descadastrado</Pilula>}
                    {c.campaignName && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>📣 {c.campaignName}</span>}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="conv-chat" style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', background: '#EFEAE2', overflow: 'hidden' }}>
        {aberta ? <Chat key={aberta} id={aberta} onVoltar={() => abrir(null)} onMudou={carregarLista} /> : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30, color: 'var(--muted)', background: 'var(--card-2)' }}>
            <span style={{ width: 72, height: 72, borderRadius: 99, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><MessageCircle size={32} /></span>
            <strong style={{ color: 'var(--ink)', fontSize: 17 }}>Respostas das suas campanhas</strong>
            <p style={{ maxWidth: 380, fontSize: 14, lineHeight: 1.55 }}>Escolha uma conversa pra ver o que o contato respondeu e responder por aqui, pelo mesmo número que fez o disparo.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Chat({ id, onVoltar, onMudou }: { id: number; onVoltar: () => void; onMudou: () => void }) {
  const [c, setC] = useState<Detalhe | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<{ path: string; name: string; mime: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const [maisAntigas, setMaisAntigas] = useState(true);
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);
  const ultimoId = useRef(0);

  const carregar = useCallback(async () => {
    const [d, m] = await Promise.all([api<{ conversation: Detalhe }>('GET', `/conversations/${id}`), api<{ messages: Msg[] }>('GET', `/conversations/${id}/messages?limit=50`)]);
    setC(d.conversation); setMsgs(m.messages); setMaisAntigas(m.messages.length === 50);
    ultimoId.current = m.messages.at(-1)?.id ?? 0;
    if (d.conversation.unread > 0) { await api('POST', `/conversations/${id}/read`).catch(() => {}); onMudou() }
  }, [id, onMudou]);

  useEffect(() => { carregar().catch(erro) }, [carregar]);

  // novas mensagens a cada 3 s (e atualiza os tiques das recentes)
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await api<{ messages: Msg[] }>('GET', `/conversations/${id}/messages?limit=30`);
        setMsgs(atual => {
          if (!atual) return r.messages;
          const mapa = new Map(atual.map(m => [m.id, m]));
          for (const m of r.messages) mapa.set(m.id, m);
          return [...mapa.values()].sort((a, b) => a.id - b.id);
        });
        const novo = r.messages.at(-1)?.id ?? 0;
        if (novo > ultimoId.current) {
          ultimoId.current = novo;
          if (r.messages.some(m => !m.fromMe && m.id > ultimoId.current - 1)) api('POST', `/conversations/${id}/read`).then(onMudou).catch(() => {});
        }
      } catch { /* tenta de novo */ }
    }, 3000);
    return () => clearInterval(t);
  }, [id, onMudou]);

  useLayoutEffect(() => { if (colarNoFim.current) fim.current?.scrollIntoView({ block: 'end' }) }, [msgs]);
  const aoRolar = () => { const el = caixa.current; if (el) colarNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 };

  const antigas = async () => {
    if (!msgs?.length) return;
    const el = caixa.current; const altura = el?.scrollHeight ?? 0;
    const r = await api<{ messages: Msg[] }>('GET', `/conversations/${id}/messages?limit=50&before=${msgs[0].id}`);
    colarNoFim.current = false;
    setMsgs(m => [...r.messages, ...(m || [])]); setMaisAntigas(r.messages.length === 50);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - altura });
  };

  const anexar = async (f: File | undefined) => {
    if (!f) return;
    setSubindo(true);
    try { const fd = new FormData(); fd.append('file', f); setAnexo(await api('POST', '/campaigns/upload', fd)) } catch (e) { erro(e) } finally { setSubindo(false) }
  };

  const enviar = async () => {
    if (enviando || (!texto.trim() && !anexo)) return;
    setEnviando(true);
    try {
      const r = await api<{ message: Msg }>('POST', `/conversations/${id}/messages`, { text: texto, media: anexo });
      colarNoFim.current = true;
      setMsgs(m => [...(m || []), { ...r.message, hasMedia: !!anexo, sentByName: null } as Msg]);
      ultimoId.current = Math.max(ultimoId.current, r.message.id);
      setTexto(''); setAnexo(null); onMudou();
    } catch (e) { erro(e) } finally { setEnviando(false) }
  };

  const alternarBloqueio = async () => {
    if (!c) return;
    if (!c.optOut && !(await confirmar('Bloquear campanhas pra este contato?', 'Ele não recebe mais disparos (a conversa continua funcionando).', 'Bloquear', true))) return;
    try { await api('POST', `/conversations/${id}/optout`, { optOut: !c.optOut }); setC({ ...c, optOut: !c.optOut }); ok(c.optOut ? 'Campanhas liberadas.' : 'Contato bloqueado pra campanhas.'); onMudou() } catch (e) { erro(e) }
  };

  if (!c || !msgs) return <Carregando />;
  let diaAnterior = '';

  return (
    <>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
        <button className="so-mobile" onClick={onVoltar} aria-label="Voltar" style={{ border: 'none', background: 'none', padding: 4, alignItems: 'center' }}><ArrowLeft size={20} /></button>
        <Avatar url={c.avatarUrl} nome={c.name || c.waName || ''} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.waName || fmtTel(c.phone)}{c.waName && c.name && c.waName !== c.name && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12.5 }}> · ~{c.waName}</span>}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fmtTel(c.phone)} · pelo número {c.connectionName}{c.campaign && <> · <Link to={`/campanhas/${c.campaign.id}`}>📣 {c.campaign.name}</Link></>}
          </div>
        </div>
        {c.optOut && <span className="esconde-mobile"><Pilula cor="vermelho">Descadastrado</Pilula></span>}
        <button onClick={alternarBloqueio} title={c.optOut ? 'Liberar campanhas pra este contato' : 'Não enviar mais campanhas pra este contato'} style={btn('ghost', { minHeight: 32, padding: '0 10px' })}>
          {c.optOut ? <><ShieldCheck size={15} /> <span className="esconde-mobile">Liberar</span></> : <><Ban size={15} /> <span className="esconde-mobile">Bloquear</span></>}
        </button>
      </header>

      <div ref={caixa} onScroll={aoRolar} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 5%', backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        {maisAntigas && msgs.length > 0 && <div style={{ textAlign: 'center', marginBottom: 10 }}><button onClick={antigas} style={btn('ghost', { minHeight: 28, fontSize: 12 })}>Mensagens anteriores</button></div>}
        {msgs.map(m => {
          const dia = new Date(m.createdAt).toDateString();
          const separador = dia !== diaAnterior ? diaLabel(m.createdAt) : null;
          diaAnterior = dia;
          if (m.type === 'call') {
            return (
              <div key={m.id}>
                {separador && <Separador texto={separador} />}
                <div style={{ textAlign: 'center', margin: '8px 0' }}><span style={{ display: 'inline-block', padding: '5px 12px', background: '#fff', borderRadius: 8, fontSize: 12.5, color: 'var(--muted)', boxShadow: '0 1px .5px rgba(11,20,26,.13)' }}>{m.text} · {hora(m.createdAt)}</span></div>
              </div>
            );
          }
          return (
            <div key={m.id}>
              {separador && <Separador texto={separador} />}
              <div style={{ display: 'flex', justifyContent: m.fromMe ? 'flex-end' : 'flex-start', margin: '3px 0' }}>
                <div style={{ maxWidth: 'min(75%, 520px)', background: m.fromMe ? 'var(--balao)' : '#fff', borderRadius: m.fromMe ? '8px 0 8px 8px' : '0 8px 8px 8px', padding: '6px 8px 4px', boxShadow: '0 1px .5px rgba(11,20,26,.13)', fontSize: 14, lineHeight: 1.45 }}>
                  {m.campaignId && <div style={{ fontSize: 11, color: 'var(--verde-escuro)', fontWeight: 700, marginBottom: 3 }}>📣 Campanha</div>}
                  {m.sentByName && <div style={{ fontSize: 11, color: '#1D5FC2', fontWeight: 700, marginBottom: 3 }}>{m.sentByName}</div>}
                  {m.hasMedia && <div style={{ marginBottom: m.text ? 4 : 0 }}><Midia m={m} /></div>}
                  {m.text && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: formatar(m.text) }} />}
                  {!m.text && !m.hasMedia && <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{m.type === 'location' ? '📍 Localização' : m.type === 'contact' ? '👤 Contato' : 'Mensagem não suportada'}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {hora(m.createdAt)} {m.fromMe && <Tiques status={m.status} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      <footer style={{ flex: 'none', background: '#F0F2F5', padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
        {anexo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#fff', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
            <Paperclip size={15} /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{anexo.name}</span>
            <button onClick={() => setAnexo(null)} aria-label="Tirar anexo" style={{ border: 'none', background: 'none', padding: 2, display: 'flex' }}><X size={16} /></button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <label title="Anexar arquivo" style={{ width: 40, height: 40, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', flex: 'none' }}>
            {subindo ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : <Paperclip size={20} />}
            <input type="file" style={{ display: 'none' }} disabled={subindo} onChange={e => { anexar(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1} placeholder={anexo ? 'Legenda (opcional)' : 'Digite uma mensagem'}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            style={{ ...inputStyle, flex: 1, resize: 'none', maxHeight: 140, minHeight: 40, border: 'none', borderRadius: 8, lineHeight: 1.4, padding: '10px 12px' }} />
          <button onClick={enviar} disabled={enviando || (!texto.trim() && !anexo)} aria-label="Enviar" style={{ width: 42, height: 42, borderRadius: 99, border: 'none', background: 'var(--verde)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            {enviando ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} />}
          </button>
        </div>
      </footer>
    </>
  );
}

function Separador({ texto }: { texto: string }) {
  return <div style={{ textAlign: 'center', margin: '12px 0 8px' }}><span style={{ display: 'inline-block', padding: '4px 12px', background: '#fff', borderRadius: 8, fontSize: 12, color: '#54656F', boxShadow: '0 1px .5px rgba(11,20,26,.13)' }}>{texto}</span></div>;
}
