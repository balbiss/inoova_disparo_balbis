import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Image as ImageIcon, Mic, MessageSquareText, PhoneCall, Play, Save, Type, Upload, Video, X, AlertTriangle } from 'lucide-react';
import { api, erro, fmtNum, ok } from '../lib/api';
import { Cabecalho, Card, Campo, Carregando, btn, inputStyle } from '../components/ui';

type Conexao = { id: number; name: string; phone: string | null; connected: boolean };
type Categoria = { id: number; name: string; color: string; total: number };
type Midia = { path: string; name: string; mime: string; size: number; preview: string };

const TIPOS: { v: string; label: string; icon: ReactNode; aceita: string }[] = [
  { v: 'text', label: 'Texto', icon: <Type size={18} />, aceita: '' },
  { v: 'image', label: 'Imagem', icon: <ImageIcon size={18} />, aceita: 'image/*' },
  { v: 'video', label: 'Vídeo', icon: <Video size={18} />, aceita: 'video/mp4,video/*' },
  { v: 'audio', label: 'Áudio', icon: <Mic size={18} />, aceita: 'audio/*' },
  { v: 'document', label: 'Documento', icon: <FileText size={18} />, aceita: '' },
];

function Passo({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 26, height: 26, borderRadius: 99, background: 'var(--teal)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <strong style={{ fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>{titulo}</strong>
      </div>
      {children}
    </Card>
  );
}

function Opcao({ ativo, onClick, icone, titulo, texto }: { ativo: boolean; onClick: () => void; icone: ReactNode; titulo: string; texto: string }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: '1 1 220px', textAlign: 'left', display: 'flex', gap: 12, padding: 14, borderRadius: 6, border: `2px solid ${ativo ? 'var(--verde)' : 'var(--line)'}`, background: ativo ? 'var(--verde-soft)' : 'var(--card)' }}>
      <span style={{ color: ativo ? 'var(--verde-escuro)' : 'var(--muted)', marginTop: 2 }}>{icone}</span>
      <span><span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>{titulo}</span><span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{texto}</span></span>
    </button>
  );
}

/** Texto com {nome} etc. como ficaria pra um contato de exemplo (formatação *negrito* _itálico_ do WhatsApp). */
function previaTexto(t: string) {
  const amostra = t.replace(/\{primeiro_nome\}/gi, 'Maria').replace(/\{nome\}/gi, 'Maria Silva').replace(/\{([^{}]*\|[^{}]*)\}/g, (_, o: string) => o.split('|')[0]);
  const esc = amostra.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export default function NovaCampanha() {
  const nav = useNavigate();
  const [conns, setConns] = useState<Conexao[] | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [totalContatos, setTotalContatos] = useState(0);

  const [nome, setNome] = useState('');
  const [kind, setKind] = useState<'message' | 'call'>('message');
  const [connId, setConnId] = useState<number | ''>('');
  const [tipo, setTipo] = useState('text');
  const [texto, setTexto] = useState('');
  const [midia, setMidia] = useState<Midia | null>(null);
  const [enviandoArq, setEnviandoArq] = useState(false);
  const [callVideo, setCallVideo] = useState(false);
  const [toque, setToque] = useState(40);
  const [publico, setPublico] = useState<'all' | 'cats'>('all');
  const [catsSel, setCatsSel] = useState<number[]>([]);
  const [min, setMin] = useState(20);
  const [max, setMax] = useState(45);
  const [salvando, setSalvando] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    Promise.all([
      api<{ connections: Conexao[] }>('GET', '/connections'),
      api<{ categories: Categoria[] }>('GET', '/contacts/categories'),
      api<{ total: number }>('GET', '/contacts?per=10'),
    ]).then(([a, b, c]) => {
      setConns(a.connections); setCats(b.categories); setTotalContatos(c.total);
      const conectado = a.connections.find(x => x.connected) || a.connections[0];
      if (conectado) setConnId(conectado.id);
    }).catch(erro);
  }, []);

  // ligação: intervalo maior por padrão (cada ligação toca até o tempo de toque)
  useEffect(() => { if (kind === 'call') { setMin(m => Math.max(m, 30)); setMax(m => Math.max(m, 60)) } }, [kind]);

  const aceita = kind === 'call' ? (callVideo ? 'video/mp4,video/*' : 'audio/*,video/mp4') : TIPOS.find(t => t.v === tipo)?.aceita ?? '';
  const precisaMidia = kind === 'call' || tipo !== 'text';
  const qtdPublico = useMemo(() => publico === 'all' ? totalContatos : cats.filter(c => catsSel.includes(c.id)).reduce((s, c) => s + c.total, 0), [publico, totalContatos, cats, catsSel]);
  const conexao = conns?.find(c => c.id === connId);
  const mediaSeg = (min + max) / 2 + (kind === 'call' ? toque / 2 : 2);
  const duracao = qtdPublico * mediaSeg;
  const fmtDur = (s: number) => s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

  const enviarArquivo = async (f: File | undefined) => {
    if (!f) return;
    setEnviandoArq(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<Omit<Midia, 'preview'>>('POST', '/campaigns/upload', fd);
      if (midia?.preview) URL.revokeObjectURL(midia.preview);
      setMidia({ ...r, preview: URL.createObjectURL(f) });
    } catch (e) { erro(e) } finally { setEnviandoArq(false) }
  };

  const inserir = (v: string) => {
    const el = textoRef.current;
    if (!el) return setTexto(t => t + v);
    const i = el.selectionStart, f = el.selectionEnd;
    setTexto(t => t.slice(0, i) + v + t.slice(f));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = i + v.length }, 0);
  };

  const valido = nome.trim().length >= 2 && !!connId && qtdPublico > 0 && min >= (kind === 'call' ? 10 : 5) && max >= min
    && (kind === 'call' ? !!midia : tipo === 'text' ? !!texto.trim() : !!midia);

  const salvar = async (iniciar: boolean) => {
    setSalvando(true);
    try {
      const r = await api<{ campaign: { id: number }; total: number }>('POST', '/campaigns', {
        name: nome, kind, connectionId: connId, messageType: kind === 'call' ? 'audio' : tipo, text: kind === 'call' ? '' : texto,
        media: midia ? { path: midia.path, name: midia.name, mime: midia.mime } : null,
        callVideo, maxRingSeconds: toque, minDelay: min, maxDelay: max,
        audience: publico === 'all' ? { all: true } : { categoryIds: catsSel },
        start: false,
      });
      if (iniciar) {
        try { await api('POST', `/campaigns/${r.campaign.id}/start`); ok(`Campanha iniciada pra ${fmtNum(r.total)} contato(s).`) }
        catch (e) { erro(e); ok('Campanha salva como rascunho.') }
      } else ok('Rascunho salvo.');
      nav(`/campanhas/${r.campaign.id}`);
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };

  if (!conns) return <Carregando />;

  return (
    <>
      <Link to="/campanhas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}><ArrowLeft size={15} /> Campanhas</Link>
      <Cabecalho titulo="Nova campanha" />

      {conns.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--alerta-soft)', border: '1px solid #F7D9A4', borderRadius: 4, marginBottom: 14, fontSize: 14 }}>
          <AlertTriangle size={18} color="#9A6100" /> <span style={{ flex: 1 }}>Você precisa conectar um número de WhatsApp antes de criar campanhas.</span>
          <Link to="/conexoes" style={btn('ghost', { minHeight: 32 })}>Conectar número</Link>
        </div>
      )}

      <div className="grid-camp">
        <div>
          <Passo n={1} titulo="Tipo de campanha">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Opcao ativo={kind === 'message'} onClick={() => { setKind('message'); setMidia(null) }} icone={<MessageSquareText size={22} />} titulo="Mensagem" texto="Texto, imagem, vídeo, áudio ou documento no WhatsApp de cada contato." />
              <Opcao ativo={kind === 'call'} onClick={() => { setKind('call'); setMidia(null) }} icone={<PhoneCall size={22} />} titulo="Ligação" texto="Liga pelo WhatsApp e, quando a pessoa atende, toca um áudio ou vídeo gravado." />
            </div>
            <Campo label="Nome da campanha (só pra você)" style={{ marginTop: 16, marginBottom: 0 }}>
              <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} placeholder={kind === 'call' ? 'Ex.: Ligação Black Friday' : 'Ex.: Promoção de novembro'} maxLength={120} />
            </Campo>
          </Passo>

          <Passo n={2} titulo="Conteúdo">
            {kind === 'message' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {TIPOS.map(t => (
                  <button key={t.v} type="button" onClick={() => { setTipo(t.v); setMidia(null) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 4, border: `1px solid ${tipo === t.v ? 'var(--verde)' : 'var(--line)'}`, background: tipo === t.v ? 'var(--verde-soft)' : 'var(--card)', color: tipo === t.v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 14, fontWeight: 700 }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            )}
            {kind === 'call' && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={!callVideo} onChange={() => { setCallVideo(false); setMidia(null) }} /> Ligação de áudio</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={callVideo} onChange={() => { setCallVideo(true); setMidia(null) }} /> Ligação de vídeo</label>
              </div>
            )}

            {precisaMidia && (
              midia ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card-2)', marginBottom: 14 }}>
                  {midia.mime.startsWith('image/') ? <img src={midia.preview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4 }} />
                    : <span style={{ width: 56, height: 56, borderRadius: 4, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{midia.mime.startsWith('video/') ? <Video size={24} /> : midia.mime.startsWith('audio/') ? <Mic size={24} /> : <FileText size={24} />}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{midia.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(midia.size / 1024 / 1024).toFixed(2)} MB</div>
                    {midia.mime.startsWith('audio/') && <audio src={midia.preview} controls style={{ height: 32, marginTop: 6, maxWidth: '100%' }} />}
                  </div>
                  <button type="button" title="Trocar arquivo" onClick={() => setMidia(null)} style={{ border: 'none', background: 'none', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
                </div>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 22, border: '2px dashed #C9D1D5', borderRadius: 6, cursor: 'pointer', background: 'var(--card-2)', marginBottom: 14, textAlign: 'center' }}>
                  {enviandoArq ? <Carregando texto="Enviando arquivo…" /> : <>
                    <Upload size={24} color="var(--verde-escuro)" />
                    <strong style={{ fontSize: 14 }}>{kind === 'call' ? (callVideo ? 'Escolher o vídeo da ligação (MP4)' : 'Escolher o áudio da ligação') : `Escolher ${TIPOS.find(t => t.v === tipo)?.label.toLowerCase()}`}</strong>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{kind === 'call' ? 'O arquivo toca quando a pessoa atende e a ligação encerra ao fim dele.' : 'Até 64 MB. O WhatsApp aceita vídeos de até 16 MB com melhor qualidade.'}</span>
                  </>}
                  <input type="file" accept={aceita} style={{ display: 'none' }} disabled={enviandoArq} onChange={e => { enviarArquivo(e.target.files?.[0]); e.target.value = '' }} />
                </label>
              )
            )}

            {kind === 'message' && tipo !== 'audio' && (
              <Campo label={tipo === 'text' ? 'Mensagem' : 'Legenda (opcional)'} style={{ marginBottom: 0 }}
                ajuda={<>Variáveis: <button type="button" style={chipVar} onClick={() => inserir('{primeiro_nome}')}>{'{primeiro_nome}'}</button> <button type="button" style={chipVar} onClick={() => inserir('{nome}')}>{'{nome}'}</button> · Variação contra bloqueio: <button type="button" style={chipVar} onClick={() => inserir('{Oi|Olá|Tudo bem}')}>{'{Oi|Olá}'}</button> sorteia uma opção por contato. *negrito* _itálico_</>}>
                <textarea ref={textoRef} style={{ ...inputStyle, minHeight: 130, resize: 'vertical', lineHeight: 1.5 }} value={texto} onChange={e => setTexto(e.target.value)} maxLength={4096}
                  placeholder={'{Oi|Olá} {primeiro_nome}! 👋\n\nTemos uma novidade pra você…'} />
              </Campo>
            )}
            {kind === 'call' && (
              <Campo label="Tempo máximo tocando" ajuda="Se a pessoa não atender nesse tempo, conta como “não atendeu” e passa pro próximo." style={{ marginBottom: 0 }}>
                <select style={inputStyle} value={toque} onChange={e => setToque(Number(e.target.value))}>
                  {[20, 30, 40, 50, 60].map(s => <option key={s} value={s}>{s} segundos</option>)}
                </select>
              </Campo>
            )}
          </Passo>

          <Passo n={3} titulo="Número e público">
            <Campo label="Enviar pelo número">
              <select style={inputStyle} value={connId} onChange={e => setConnId(Number(e.target.value) || '')}>
                {conns.length === 0 && <option value="">Nenhum número conectado</option>}
                {conns.map(c => <option key={c.id} value={c.id}>{c.name}{c.connected ? '' : ' (desconectado)'}</option>)}
              </select>
            </Campo>
            {conexao && !conexao.connected && <p style={{ margin: '-6px 0 14px', fontSize: 13, color: '#9A6100' }}>Esse número está desconectado: dá pra salvar como rascunho e iniciar depois de conectar.</p>}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={publico === 'all'} onChange={() => setPublico('all')} /> Todos os contatos ({fmtNum(totalContatos)})</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={publico === 'cats'} onChange={() => setPublico('cats')} disabled={!cats.length} /> Só algumas categorias</label>
            </div>
            {publico === 'cats' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {cats.map(c => {
                  const on = catsSel.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setCatsSel(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                      style={{ padding: '6px 11px', borderRadius: 4, border: `1px solid ${on ? c.color : 'var(--line)'}`, background: on ? c.color + '1A' : 'var(--card)', color: on ? c.color : 'var(--ink)', fontSize: 13, fontWeight: 700 }}>
                      {on ? '✓ ' : ''}{c.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{fmtNum(c.total)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {totalContatos === 0 && <p style={{ fontSize: 13, color: '#9A6100', margin: '8px 0 0' }}>Sua lista de contatos está vazia. <Link to="/contatos">Importe contatos</Link> primeiro.</p>}
          </Passo>

          <Passo n={4} titulo="Intervalo entre envios">
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>O sistema espera um tempo sorteado entre o mínimo e o máximo antes de cada {kind === 'call' ? 'ligação' : 'mensagem'}. Intervalos maiores reduzem o risco de bloqueio do número.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Campo label="Mínimo (segundos)" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><input type="number" min={kind === 'call' ? 10 : 5} max={3600} style={inputStyle} value={min} onChange={e => setMin(Number(e.target.value))} /></Campo>
              <Campo label="Máximo (segundos)" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}><input type="number" min={min} max={3600} style={inputStyle} value={max} onChange={e => setMax(Number(e.target.value))} /></Campo>
            </div>
            {max < min && <p style={{ color: 'var(--perigo)', fontSize: 13, margin: '8px 0 0' }}>O máximo precisa ser maior ou igual ao mínimo.</p>}
          </Passo>
        </div>

        <div style={{ position: 'sticky', top: 76 }}>
          <Card title="Prévia">
            <div style={{ background: '#EFEAE2', backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px', borderRadius: 6, padding: 14, minHeight: 160 }}>
              {kind === 'call' ? (
                <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--teal)' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 99, background: 'var(--teal)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>{callVideo ? <Video size={26} /> : <PhoneCall size={26} />}</div>
                  <div style={{ fontWeight: 700 }}>Chamada de {callVideo ? 'vídeo' : 'voz'} do WhatsApp</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{midia ? `Ao atender, toca “${midia.name}”` : 'Escolha o arquivo que vai tocar'}</div>
                </div>
              ) : (
                <div style={{ marginLeft: 'auto', maxWidth: '88%', background: 'var(--balao)', borderRadius: '8px 0 8px 8px', padding: 6, boxShadow: '0 1px .5px rgba(11,20,26,.13)', fontSize: 14, lineHeight: 1.45 }}>
                  {midia && tipo === 'image' && <img src={midia.preview} alt="" style={{ width: '100%', borderRadius: 6, display: 'block' }} />}
                  {midia && tipo === 'video' && <video src={midia.preview} style={{ width: '100%', borderRadius: 6, display: 'block' }} controls />}
                  {tipo === 'audio' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px' }}><Play size={20} color="var(--muted)" /><div style={{ flex: 1, height: 3, background: '#9FB3A9', borderRadius: 99 }} /><Mic size={16} color="var(--verde)" /></div>}
                  {tipo === 'document' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'rgba(0,0,0,.05)', borderRadius: 6 }}><FileText size={22} color="#E5484D" /><span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{midia?.name || 'documento.pdf'}</span></div>}
                  {tipo !== 'audio' && (texto.trim()
                    ? <div style={{ padding: '4px 6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: previaTexto(texto) }} />
                    : tipo === 'text' && <div style={{ padding: '4px 6px 0', color: 'var(--muted)', fontStyle: 'italic' }}>Sua mensagem aparece aqui</div>)}
                  <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)', padding: '2px 4px 0' }}>12:00 ✓✓</div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 14, marginTop: 14, lineHeight: 1.8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Contatos</span><b>{fmtNum(qtdPublico)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Tempo estimado</span><b>{qtdPublico ? '~' + fmtDur(duracao) : '—'}</b></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <button style={btn()} disabled={!valido || salvando} onClick={() => salvar(true)}><Play size={15} /> {salvando ? 'Salvando…' : 'Salvar e iniciar'}</button>
              <button style={btn('ghost')} disabled={!valido || salvando} onClick={() => salvar(false)}><Save size={15} /> Salvar rascunho</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const chipVar = { border: '1px solid var(--line)', background: 'var(--card-2)', borderRadius: 3, padding: '0 5px', fontSize: 12, fontFamily: 'monospace', color: 'var(--verde-escuro)' };
