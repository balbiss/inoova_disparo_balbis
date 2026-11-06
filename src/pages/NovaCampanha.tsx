import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, BarChart3, CalendarClock, ChevronDown, ChevronUp, Copy, ExternalLink, FileText, Image as ImageIcon,
  MessageSquareText, Mic, Phone, PhoneCall, Play, Plus, Reply, Save, ShieldCheck, Trash2, Type, Upload, Video, X,
} from 'lucide-react';
import { api, erro, fmtNum, ok } from '../lib/api';
import { Card, Cabecalho, Campo, Carregando, btn, inputStyle } from '../components/ui';

type Conexao = { id: number; name: string; phone: string | null; connected: boolean };
type Categoria = { id: number; name: string; color: string; total: number };
type Midia = { path: string; name: string; mime: string; size: number; preview: string };
type Botao = { type: 'quick_reply' | 'cta_url' | 'cta_call' | 'cta_copy'; text: string; value: string };
type Seg = {
  intervaloMin: number; intervaloMax: number; pausaCadaMin: number; pausaCadaMax: number; pausaMin: number; pausaMax: number;
  limiteHora: number; limiteDia: number; horarioInicio: string; horarioFim: string; diasSemana: number[];
  verificarWhatsapp: boolean; pularEmConversa: boolean; aquecimento: boolean; toqueMin: number; toqueMax: number;
  preMsgAtivo: boolean; preMsgs: string[]; preEsperaMin: number; preEsperaMax: number; preCondicao: 'sempre' | 'entregue' | 'lida' | 'respondeu';
};

const TIPOS: { v: string; label: string; icon: ReactNode; aceita: string }[] = [
  { v: 'text', label: 'Texto', icon: <Type size={18} />, aceita: '' },
  { v: 'image', label: 'Imagem', icon: <ImageIcon size={18} />, aceita: 'image/*' },
  { v: 'video', label: 'Vídeo', icon: <Video size={18} />, aceita: 'video/mp4,video/*' },
  { v: 'audio', label: 'Áudio', icon: <Mic size={18} />, aceita: 'audio/*' },
  { v: 'document', label: 'Documento', icon: <FileText size={18} />, aceita: '' },
  { v: 'poll', label: 'Enquete', icon: <BarChart3 size={18} />, aceita: '' },
];
const TIPO_BOTAO: Record<Botao['type'], { label: string; icon: ReactNode; campo?: string; placeholder?: string }> = {
  quick_reply: { label: 'Resposta rápida', icon: <Reply size={14} /> },
  cta_url: { label: 'Abrir link', icon: <ExternalLink size={14} />, campo: 'Link', placeholder: 'https://seusite.com.br' },
  cta_call: { label: 'Ligar', icon: <Phone size={14} />, campo: 'Telefone', placeholder: '(91) 98888-7777' },
  cta_copy: { label: 'Copiar código', icon: <Copy size={14} />, campo: 'Código', placeholder: 'CUPOM10' },
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Passo({ n, titulo, children, direita }: { n: number; titulo: string; children: ReactNode; direita?: ReactNode }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 26, height: 26, borderRadius: 99, background: 'var(--teal)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <strong style={{ fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', flex: 1 }}>{titulo}</strong>
        {direita}
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

function Chave({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.45, cursor: 'pointer' }}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3 }} /> <span>{children}</span></label>;
}

/** Texto como ficaria pra um contato de exemplo (formatação do WhatsApp). */
function previaTexto(t: string) {
  const amostra = t.replace(/\{primeiro_nome\}/gi, 'Maria').replace(/\{nome\}/gi, 'Maria Silva').replace(/\{([^{}]*\|[^{}]*)\}/g, (_, o: string) => o.split('|')[0]);
  const esc = amostra.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

const agoraLocal = (minutos = 0) => { const d = new Date(Date.now() + minutos * 60_000 - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) };

export default function NovaCampanha() {
  const nav = useNavigate();
  const [conns, setConns] = useState<Conexao[] | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [resumo, setResumo] = useState({ total: 0, optOut: 0, invalid: 0 });

  const [nome, setNome] = useState('');
  const [kind, setKind] = useState<'message' | 'call'>('message');
  const [connId, setConnId] = useState<number | ''>('');
  const [tipo, setTipo] = useState('text');
  const [textos, setTextos] = useState<string[]>(['']);
  const [versaoAtiva, setVersaoAtiva] = useState(0);
  const [midia, setMidia] = useState<Midia | null>(null);
  const [enviandoArq, setEnviandoArq] = useState(false);
  const [callVideo, setCallVideo] = useState(false);
  const [botoes, setBotoes] = useState<Botao[]>([]);
  const [botaoSair, setBotaoSair] = useState(true);
  const [rodape, setRodape] = useState('');
  const [opcoes, setOpcoes] = useState<string[]>(['', '']);
  const [multipla, setMultipla] = useState(false);
  const [digitando, setDigitando] = useState(true);
  const [pularSemWhats, setPularSemWhats] = useState(true);
  const [publico, setPublico] = useState<'all' | 'cats'>('all');
  const [catsSel, setCatsSel] = useState<number[]>([]);
  const [seg, setSeg] = useState<Seg | null>(null);
  const [segAberta, setSegAberta] = useState(false);
  const [quando, setQuando] = useState<'agora' | 'agendar' | 'rascunho'>('agora');
  const [agendada, setAgendada] = useState(agoraLocal(60));
  const [salvando, setSalvando] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    Promise.all([
      api<{ connections: Conexao[] }>('GET', '/connections'),
      api<{ categories: Categoria[] }>('GET', '/contacts/categories'),
      api<{ total: number; optOut: number; invalid: number }>('GET', '/contacts/summary'),
    ]).then(([a, b, c]) => {
      setConns(a.connections); setCats(b.categories); setResumo(c);
      const conectado = a.connections.find(x => x.connected) || a.connections[0];
      if (conectado) setConnId(conectado.id);
    }).catch(erro);
  }, []);
  // padrões de segurança do tipo escolhido (definidos pelo administrador do sistema)
  useEffect(() => { api<{ seguranca: Seg }>('GET', `/campaigns/seguranca-padrao?kind=${kind}`).then(r => setSeg(r.seguranca)).catch(erro) }, [kind]);

  const ehTexto = kind === 'message' && tipo === 'text';
  const aceita = kind === 'call' ? (callVideo ? 'video/mp4,video/*' : 'audio/*,video/mp4') : TIPOS.find(t => t.v === tipo)?.aceita ?? '';
  const precisaMidia = kind === 'call' || !['text', 'poll'].includes(tipo);
  const usaTexto = kind === 'message' && tipo !== 'audio';
  const qtdPublico = useMemo(() => {
    const bruto = publico === 'all' ? resumo.total : cats.filter(c => catsSel.includes(c.id)).reduce((s, c) => s + c.total, 0);
    // estimativa: descadastrados nunca recebem (sem WhatsApp também, se marcado)
    if (publico === 'all') return Math.max(0, bruto - resumo.optOut - (pularSemWhats ? resumo.invalid : 0));
    return bruto;
  }, [publico, resumo, cats, catsSel, pularSemWhats]);
  const conexao = conns?.find(c => c.id === connId);
  const totalBotoes = botoes.length + (botaoSair ? 1 : 0);

  const enviarArquivo = async (f: File | undefined) => {
    if (!f) return;
    setEnviandoArq(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api<Omit<Midia, 'preview'>>('POST', '/campaigns/upload', fd);
      if (midia?.preview) URL.revokeObjectURL(midia.preview);
      setMidia({ ...r, preview: URL.createObjectURL(f) });
    } catch (e) { erro(e) } finally { setEnviandoArq(false) }
  };

  const setTexto = (v: string) => setTextos(t => t.map((x, i) => (i === versaoAtiva ? v : x)));
  const inserir = (v: string) => {
    const el = textoRef.current, atual = textos[versaoAtiva] || '';
    if (!el) return setTexto(atual + v);
    const i = el.selectionStart, f = el.selectionEnd;
    setTexto(atual.slice(0, i) + v + atual.slice(f));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = i + v.length }, 0);
  };
  const novaVersao = () => { if (textos.length < 6) { setTextos(t => [...t, '']); setVersaoAtiva(textos.length) } };
  const tirarVersao = (i: number) => { setTextos(t => t.filter((_, j) => j !== i)); setVersaoAtiva(0) };

  const textoPrincipal = textos[0] || '';
  const opcoesValidas = opcoes.map(o => o.trim()).filter(Boolean);
  const valido = nome.trim().length >= 2 && !!connId && qtdPublico > 0 && !!seg
    && (kind === 'call' ? !!midia && (!seg.preMsgAtivo || seg.preMsgs.some(m => m.trim()))
      : tipo === 'text' ? !!textoPrincipal.trim() && totalBotoes <= 3 && botoes.every(b => b.text.trim() && (b.type === 'quick_reply' || b.value.trim()))
        : tipo === 'poll' ? !!textoPrincipal.trim() && opcoesValidas.length >= 2
          : !!midia)
    && (quando !== 'agendar' || !!agendada);

  const salvar = async () => {
    if (!seg) return;
    setSalvando(true);
    try {
      const r = await api<{ campaign: { id: number }; total: number; excluded: { optOut: number; noWhatsapp: number } }>('POST', '/campaigns', {
        name: nome, kind, connectionId: connId, messageType: kind === 'call' ? 'audio' : tipo,
        text: usaTexto ? textoPrincipal : '', textVariants: usaTexto && tipo !== 'poll' ? textos.slice(1).filter(t => t.trim()) : [],
        media: midia ? { path: midia.path, name: midia.name, mime: midia.mime } : null, callVideo,
        buttons: ehTexto ? botoes.map(b => ({ type: b.type, text: b.text.trim(), value: b.value.trim() || undefined })) : [],
        optOutButton: ehTexto && botaoSair, footer: ehTexto ? rodape : '',
        pollOptions: tipo === 'poll' ? opcoesValidas : [], pollMulti: multipla,
        typing: digitando, skipInvalid: pularSemWhats, seguranca: seg,
        audience: publico === 'all' ? { all: true } : { categoryIds: catsSel },
        start: false, scheduledAt: quando === 'agendar' ? new Date(agendada).toISOString() : null,
      });
      const fora = r.excluded.optOut + r.excluded.noWhatsapp;
      const extra = fora ? ` (${fmtNum(fora)} ficaram de fora: descadastrados/sem WhatsApp)` : '';
      if (quando === 'agora') {
        try { await api('POST', `/campaigns/${r.campaign.id}/start`); ok(`Campanha iniciada pra ${fmtNum(r.total)} contato(s)${extra}.`) }
        catch (e) { erro(e); ok('Campanha salva como rascunho.') }
      } else ok((quando === 'agendar' ? 'Campanha agendada' : 'Rascunho salvo') + extra + '.');
      nav(`/campanhas/${r.campaign.id}`);
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };

  if (!conns || !seg) return <Carregando />;
  const S = (k: keyof Seg, v: unknown) => setSeg({ ...seg, [k]: v } as Seg);
  const num = (k: keyof Seg, w = 70) => <input type="number" style={{ ...inputStyle, width: w }} value={Number(seg[k])} onChange={e => S(k, Number(e.target.value))} />;
  const mediaSeg = (seg.intervaloMin + seg.intervaloMax) / 2 + (kind === 'call' ? (seg.toqueMin + seg.toqueMax) / 4 : 4);
  const porHora = Math.min(seg.limiteHora, 3600 / Math.max(1, mediaSeg));
  const horasDuracao = qtdPublico / Math.max(1, porHora);
  const diasDuracao = Math.ceil(qtdPublico / Math.max(1, seg.limiteDia));
  const estimativa = !qtdPublico ? '—' : horasDuracao < 1 ? `~${Math.max(1, Math.round(horasDuracao * 60))} min` : diasDuracao > 1 ? `~${diasDuracao} dias (limite de ${seg.limiteDia}/dia)` : `~${horasDuracao.toFixed(1).replace('.', ',')} h`;

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
        <div style={{ minWidth: 0 }}>
          <Passo n={1} titulo="Tipo de campanha">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Opcao ativo={kind === 'message'} onClick={() => { setKind('message'); setMidia(null) }} icone={<MessageSquareText size={22} />} titulo="Mensagem" texto="Texto (com botões), imagem, vídeo, áudio, documento ou enquete." />
              <Opcao ativo={kind === 'call'} onClick={() => { setKind('call'); setMidia(null) }} icone={<PhoneCall size={22} />} titulo="Ligação" texto="Liga pelo WhatsApp e toca um áudio ou vídeo gravado quando a pessoa atende." />
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
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 4, border: `1px solid ${tipo === t.v ? 'var(--verde)' : 'var(--line)'}`, background: tipo === t.v ? 'var(--verde-soft)' : 'var(--card)', color: tipo === t.v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 14, fontWeight: 700 }}>
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

            {precisaMidia && (midia ? (
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
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{kind === 'call' ? 'Toca quando a pessoa atende; a ligação encerra ao fim do arquivo.' : 'Até 64 MB. Vídeos até 16 MB chegam com melhor qualidade.'}</span>
                </>}
                <input type="file" accept={aceita} style={{ display: 'none' }} disabled={enviandoArq} onChange={e => { enviarArquivo(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            ))}

            {usaTexto && (
              <>
                {tipo !== 'poll' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 4 }}>Versões:</span>
                    {textos.map((_, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 4, border: `1px solid ${versaoAtiva === i ? 'var(--verde)' : 'var(--line)'}`, background: versaoAtiva === i ? 'var(--verde-soft)' : 'var(--card)' }}>
                        <button type="button" onClick={() => setVersaoAtiva(i)} style={{ border: 'none', background: 'none', padding: '5px 9px', fontSize: 13, fontWeight: 700, color: versaoAtiva === i ? 'var(--verde-escuro)' : 'var(--ink)' }}>{String.fromCharCode(65 + i)}</button>
                        {i > 0 && <button type="button" title="Tirar versão" onClick={() => tirarVersao(i)} style={{ border: 'none', background: 'none', padding: '0 6px 0 0', color: 'var(--muted)', display: 'flex' }}><X size={13} /></button>}
                      </span>
                    ))}
                    {textos.length < 6 && <button type="button" onClick={novaVersao} style={btn('link', { minHeight: 28, fontSize: 13 })}><Plus size={14} /> Outra versão</button>}
                  </div>
                )}
                <Campo label={tipo === 'poll' ? 'Pergunta da enquete' : tipo === 'text' ? `Mensagem${textos.length > 1 ? ` — versão ${String.fromCharCode(65 + versaoAtiva)}` : ''}` : `Legenda (opcional)${textos.length > 1 ? ` — versão ${String.fromCharCode(65 + versaoAtiva)}` : ''}`} style={{ marginBottom: 0 }}
                  ajuda={tipo === 'poll' ? undefined : <>Variáveis: <button type="button" style={chipVar} onClick={() => inserir('{primeiro_nome}')}>{'{primeiro_nome}'}</button> <button type="button" style={chipVar} onClick={() => inserir('{nome}')}>{'{nome}'}</button> · Variação: <button type="button" style={chipVar} onClick={() => inserir('{Oi|Olá|E aí}')}>{'{Oi|Olá}'}</button> sorteia uma opção. {textos.length > 1 ? 'As versões se revezam entre os contatos (anti-spam).' : 'Crie outras versões pra variar a mensagem e evitar bloqueio.'} *negrito* _itálico_</>}>
                  <textarea ref={textoRef} style={{ ...inputStyle, minHeight: tipo === 'poll' ? 60 : 130, resize: 'vertical', lineHeight: 1.5 }}
                    value={tipo === 'poll' ? textoPrincipal : textos[versaoAtiva] || ''} onChange={e => (tipo === 'poll' ? setTextos([e.target.value]) : setTexto(e.target.value))} maxLength={4096}
                    placeholder={tipo === 'poll' ? 'Ex.: Qual o melhor horário pra gente te atender?' : '{Oi|Olá} {primeiro_nome}! 👋\n\nTemos uma novidade pra você…'} />
                </Campo>
              </>
            )}

            {kind === 'message' && tipo === 'poll' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>Opções (até 12)</div>
                {opcoes.map((o, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input style={inputStyle} value={o} onChange={e => setOpcoes(l => l.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Opção ${i + 1}`} maxLength={100} />
                    {opcoes.length > 2 && <button type="button" onClick={() => setOpcoes(l => l.filter((_, j) => j !== i))} style={btn('ghost', { padding: '0 10px' })}><Trash2 size={14} /></button>}
                  </div>
                ))}
                {opcoes.length < 12 && <button type="button" style={btn('link')} onClick={() => setOpcoes(l => [...l, ''])}><Plus size={14} /> Opção</button>}
                <div style={{ marginTop: 8 }}><Chave checked={multipla} onChange={setMultipla}>Permitir marcar mais de uma opção</Chave></div>
              </div>
            )}

            {ehTexto && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Botões <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({totalBotoes}/3)</span></span>
                  {totalBotoes < 3 && <button type="button" style={btn('link')} onClick={() => setBotoes(b => [...b, { type: 'quick_reply', text: '', value: '' }])}><Plus size={14} /> Botão</button>}
                </div>
                {botoes.map((b, i) => {
                  const t = TIPO_BOTAO[b.type];
                  const mudar = (patch: Partial<Botao>) => setBotoes(l => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <select style={{ ...inputStyle, width: 165 }} value={b.type} onChange={e => mudar({ type: e.target.value as Botao['type'], value: '' })}>
                        {Object.entries(TIPO_BOTAO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <input style={{ ...inputStyle, flex: '1 1 150px', width: 'auto' }} value={b.text} maxLength={25} onChange={e => mudar({ text: e.target.value })} placeholder="Texto do botão" />
                      {t.campo && <input style={{ ...inputStyle, flex: '1 1 170px', width: 'auto' }} value={b.value} onChange={e => mudar({ value: e.target.value })} placeholder={t.placeholder} />}
                      <button type="button" title="Tirar botão" onClick={() => setBotoes(l => l.filter((_, j) => j !== i))} style={btn('ghost', { padding: '0 10px' })}><Trash2 size={14} /></button>
                    </div>
                  );
                })}
                <Chave checked={botaoSair} onChange={v => (v && totalBotoes >= 3 ? erro('Já tem 3 botões.') : setBotaoSair(v))}>
                  Botão <b>“Não tenho interesse”</b> — quem tocar é descadastrado e não recebe mais campanhas (protege o número de denúncias)
                </Chave>
                {(botoes.length > 0 || botaoSair) && (
                  <Campo label="Rodapé (opcional)" style={{ marginTop: 10, marginBottom: 0 }}><input style={inputStyle} value={rodape} onChange={e => setRodape(e.target.value)} maxLength={60} placeholder="Ex.: Loja Exemplo · seg a sáb" /></Campo>
                )}
              </div>
            )}

            {kind === 'call' && (
              <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
                <Chave checked={seg.preMsgAtivo} onChange={v => S('preMsgAtivo', v)}>
                  <b>Mandar uma mensagem antes de ligar</b> — a pessoa reconhece o número e atende mais. Ligação só depois que a mensagem for {seg.preCondicao === 'sempre' ? 'enviada' : seg.preCondicao === 'lida' ? 'lida' : seg.preCondicao === 'respondeu' ? 'respondida' : 'entregue'}.
                </Chave>
                {seg.preMsgAtivo && (
                  <div style={{ marginTop: 10, paddingLeft: 24 }}>
                    {(seg.preMsgs.length ? seg.preMsgs : ['']).map((m, i, arr) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input style={inputStyle} value={m} onChange={e => S('preMsgs', arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? 'Oi {primeiro_nome}! Daqui a pouco te ligo pra falar da promoção 😉' : `Versão ${i + 1}`} />
                        {arr.length > 1 && <button type="button" onClick={() => S('preMsgs', arr.filter((_, j) => j !== i))} style={btn('ghost', { padding: '0 10px' })}><Trash2 size={14} /></button>}
                      </div>
                    ))}
                    {seg.preMsgs.length < 5 && <button type="button" style={btn('link')} onClick={() => S('preMsgs', [...(seg.preMsgs.length ? seg.preMsgs : ['']), ''])}><Plus size={14} /> Outra versão</button>}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 14, marginTop: 6 }}>
                      Ligar de {num('preEsperaMin', 64)} a {num('preEsperaMax', 64)} min depois, se a mensagem foi
                      <select style={{ ...inputStyle, width: 150 }} value={seg.preCondicao} onChange={e => S('preCondicao', e.target.value)}>
                        <option value="sempre">enviada (sempre)</option><option value="entregue">entregue</option><option value="lida">lida</option><option value="respondeu">respondida</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Passo>

          <Passo n={3} titulo="Número e público">
            <Campo label="Enviar pelo número">
              <select style={inputStyle} value={connId} onChange={e => setConnId(Number(e.target.value) || '')}>
                {conns.length === 0 && <option value="">Nenhum número conectado</option>}
                {conns.map(c => <option key={c.id} value={c.id}>{c.name}{c.connected ? '' : ' (desconectado)'}</option>)}
              </select>
            </Campo>
            {conexao && !conexao.connected && <p style={{ margin: '-6px 0 14px', fontSize: 13, color: '#9A6100' }}>Esse número está desconectado: a campanha espera até você conectar.</p>}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={publico === 'all'} onChange={() => setPublico('all')} /> Todos os contatos ({fmtNum(resumo.total)})</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="radio" checked={publico === 'cats'} onChange={() => setPublico('cats')} disabled={!cats.length} /> Só algumas categorias</label>
            </div>
            {publico === 'cats' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {cats.map(c => {
                  const on = catsSel.includes(c.id);
                  return <button key={c.id} type="button" onClick={() => setCatsSel(s => (on ? s.filter(x => x !== c.id) : [...s, c.id]))}
                    style={{ padding: '6px 11px', borderRadius: 4, border: `1px solid ${on ? c.color : 'var(--line)'}`, background: on ? c.color + '1A' : 'var(--card)', color: on ? c.color : 'var(--ink)', fontSize: 13, fontWeight: 700 }}>
                    {on ? '✓ ' : ''}{c.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{fmtNum(c.total)}</span></button>;
                })}
              </div>
            )}
            {resumo.optOut > 0 && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 6px' }}>{fmtNum(resumo.optOut)} descadastrado(s) nunca recebem.</p>}
            <Chave checked={pularSemWhats} onChange={setPularSemWhats}>Pular contatos sem WhatsApp{resumo.invalid ? ` (${fmtNum(resumo.invalid)} já validados)` : ''}</Chave>
            {resumo.total === 0 && <p style={{ fontSize: 13, color: '#9A6100', margin: '8px 0 0' }}>Sua lista de contatos está vazia. <Link to="/contatos">Importe contatos</Link> primeiro.</p>}
          </Passo>

          <Passo n={4} titulo="Segurança anti-bloqueio" direita={<button type="button" style={btn('link')} onClick={() => setSegAberta(a => !a)}>{segAberta ? <><ChevronUp size={15} /> Fechar</> : <><ChevronDown size={15} /> Ajustar</>}</button>}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)' }}>
              <ShieldCheck size={18} color="var(--verde-escuro)" style={{ flex: 'none', marginTop: 2 }} />
              <span>
                {seg.intervaloMin}–{seg.intervaloMax} s entre envios · pausa de {seg.pausaMin}–{seg.pausaMax} min a cada {seg.pausaCadaMin}–{seg.pausaCadaMax} · até {seg.limiteHora}/h e {seg.limiteDia}/dia por número
                {seg.aquecimento && ' (com aquecimento de número novo)'} · das {seg.horarioInicio} às {seg.horarioFim}, {seg.diasSemana.map(d => DIAS[d]).join(', ')}
                {seg.verificarWhatsapp && ' · verifica WhatsApp'}{seg.pularEmConversa && ' · pula quem está em conversa'}{digitando && kind === 'message' && ' · “digitando…”'}
                {kind === 'call' && ` · toque de ${seg.toqueMin}–${seg.toqueMax} s`}
              </span>
            </div>
            {segAberta && (
              <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                <div style={linhaSeg}><span style={rotSeg}>Intervalo entre envios</span>{num('intervaloMin')} a {num('intervaloMax')} segundos</div>
                <div style={linhaSeg}><span style={rotSeg}>Pausa longa</span>a cada {num('pausaCadaMin', 60)} a {num('pausaCadaMax', 60)} envios, de {num('pausaMin', 60)} a {num('pausaMax', 60)} min</div>
                <div style={linhaSeg}><span style={rotSeg}>Limite por número</span>{num('limiteHora')} por hora · {num('limiteDia', 80)} por dia</div>
                <div style={linhaSeg}><span style={rotSeg}>Horário (Brasília)</span>
                  <input type="time" style={{ ...inputStyle, width: 110 }} value={seg.horarioInicio} onChange={e => S('horarioInicio', e.target.value)} /> às
                  <input type="time" style={{ ...inputStyle, width: 110 }} value={seg.horarioFim} onChange={e => S('horarioFim', e.target.value)} />
                </div>
                <div style={linhaSeg}><span style={rotSeg}>Dias</span>
                  {DIAS.map((d, i) => {
                    const on = seg.diasSemana.includes(i);
                    return <button key={d} type="button" onClick={() => S('diasSemana', on ? seg.diasSemana.filter(x => x !== i) : [...seg.diasSemana, i].sort())}
                      style={{ padding: '5px 9px', borderRadius: 4, border: `1px solid ${on ? 'var(--verde)' : 'var(--line)'}`, background: on ? 'var(--verde-soft)' : 'var(--card)', color: on ? 'var(--verde-escuro)' : 'var(--muted)', fontWeight: 700, fontSize: 12.5 }}>{d}</button>;
                  })}
                </div>
                {kind === 'call' && <div style={linhaSeg}><span style={rotSeg}>Tempo tocando</span>{num('toqueMin', 60)} a {num('toqueMax', 60)} segundos</div>}
                <div style={{ display: 'grid', gap: 8 }}>
                  <Chave checked={seg.aquecimento} onChange={v => S('aquecimento', v)}>Aquecimento de número novo (limite do dia começa baixo e sobe todo dia)</Chave>
                  <Chave checked={seg.verificarWhatsapp} onChange={v => S('verificarWhatsapp', v)}>Verificar se o contato tem WhatsApp antes de enviar</Chave>
                  <Chave checked={seg.pularEmConversa} onChange={v => S('pularEmConversa', v)}>Pular quem está conversando com a equipe (últimos 3 dias)</Chave>
                  {kind === 'message' && <Chave checked={digitando} onChange={setDigitando}>Mostrar “digitando…” antes de cada mensagem</Chave>}
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>O administrador do sistema define o intervalo mínimo e o máximo por dia; valores fora disso são ajustados ao salvar.</p>
              </div>
            )}
          </Passo>
        </div>

        <div style={{ position: 'sticky', top: 76 }}>
          <Card title="Prévia">
            <div style={{ background: '#EFEAE2', backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px', borderRadius: 6, padding: 14, minHeight: 150 }}>
              {kind === 'call' ? (
                <>
                  {seg.preMsgAtivo && seg.preMsgs[0] && <Balao><div style={{ padding: '4px 6px 0', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: previaTexto(seg.preMsgs[0]) }} /></Balao>}
                  <div style={{ textAlign: 'center', padding: '14px 0 4px', color: 'var(--teal)' }}>
                    <div style={{ width: 60, height: 60, borderRadius: 99, background: 'var(--teal)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>{callVideo ? <Video size={24} /> : <PhoneCall size={24} />}</div>
                    <div style={{ fontWeight: 700 }}>Chamada de {callVideo ? 'vídeo' : 'voz'}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{midia ? `Ao atender, toca “${midia.name}”` : 'Escolha o arquivo que vai tocar'}</div>
                  </div>
                </>
              ) : (
                <>
                  <Balao>
                    {midia && tipo === 'image' && <img src={midia.preview} alt="" style={{ width: '100%', borderRadius: 6, display: 'block' }} />}
                    {midia && tipo === 'video' && <video src={midia.preview} style={{ width: '100%', borderRadius: 6, display: 'block' }} controls />}
                    {tipo === 'audio' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px' }}><Play size={20} color="var(--muted)" /><div style={{ flex: 1, height: 3, background: '#9FB3A9', borderRadius: 99 }} /><Mic size={16} color="var(--verde)" /></div>}
                    {tipo === 'document' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'rgba(0,0,0,.05)', borderRadius: 6 }}><FileText size={22} color="#E5484D" /><span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{midia?.name || 'documento.pdf'}</span></div>}
                    {tipo === 'poll' ? (
                      <div style={{ padding: '4px 6px 0' }}>
                        <div style={{ fontWeight: 700 }}>{textoPrincipal || 'Sua pergunta'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 6px' }}>{multipla ? 'Selecione uma ou mais opções' : 'Selecione uma opção'}</div>
                        {(opcoesValidas.length ? opcoesValidas : ['Opção 1', 'Opção 2']).map(o => <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13.5 }}><span style={{ width: 16, height: 16, borderRadius: 99, border: '2px solid #8696A0' }} />{o}</div>)}
                      </div>
                    ) : tipo !== 'audio' && ((textos[versaoAtiva] || '').trim()
                      ? <div style={{ padding: '4px 6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: previaTexto(textos[versaoAtiva]) }} />
                      : tipo === 'text' && <div style={{ padding: '4px 6px 0', color: 'var(--muted)', fontStyle: 'italic' }}>Sua mensagem aparece aqui</div>)}
                    {ehTexto && rodape && <div style={{ padding: '2px 6px 0', fontSize: 12, color: 'var(--muted)' }}>{rodape}</div>}
                  </Balao>
                  {ehTexto && [...botoes.filter(b => b.text.trim()), ...(botaoSair ? [{ type: 'quick_reply' as const, text: 'Não tenho interesse', value: '' }] : [])].map((b, i) => (
                    <div key={i} style={{ marginLeft: 'auto', maxWidth: '88%', marginTop: 3, background: '#fff', borderRadius: 8, padding: '8px', textAlign: 'center', color: '#027EB5', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 1px .5px rgba(11,20,26,.13)' }}>
                      {TIPO_BOTAO[b.type].icon} {b.text}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div style={{ fontSize: 14, marginTop: 14, lineHeight: 1.8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Contatos</span><b>{fmtNum(qtdPublico)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: 'var(--muted)' }}>Tempo estimado</span><b style={{ textAlign: 'right' }}>{estimativa}</b></div>
            </div>

            <div style={{ display: 'flex', borderRadius: 4, border: '1px solid var(--line)', overflow: 'hidden', marginTop: 14 }}>
              {([['agora', 'Iniciar agora'], ['agendar', 'Agendar'], ['rascunho', 'Rascunho']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setQuando(v)} style={{ flex: 1, padding: '8px 4px', border: 'none', borderRight: v !== 'rascunho' ? '1px solid var(--line)' : 'none', background: quando === v ? 'var(--verde-soft)' : 'var(--card)', color: quando === v ? 'var(--verde-escuro)' : 'var(--ink)', fontWeight: 700, fontSize: 12.5 }}>{l}</button>
              ))}
            </div>
            {quando === 'agendar' && <Campo label="Data e hora" style={{ marginTop: 10, marginBottom: 0 }}><input type="datetime-local" style={inputStyle} value={agendada} min={agoraLocal()} onChange={e => setAgendada(e.target.value)} /></Campo>}
            <button style={btn('primary', { width: '100%', marginTop: 12 })} disabled={!valido || salvando} onClick={salvar}>
              {quando === 'agora' ? <><Play size={15} /> {salvando ? 'Iniciando…' : 'Iniciar campanha'}</> : quando === 'agendar' ? <><CalendarClock size={15} /> {salvando ? 'Agendando…' : 'Agendar campanha'}</> : <><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar rascunho'}</>}
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}

function Balao({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginLeft: 'auto', maxWidth: '88%', background: 'var(--balao)', borderRadius: '8px 0 8px 8px', padding: 6, boxShadow: '0 1px .5px rgba(11,20,26,.13)', fontSize: 14, lineHeight: 1.45, marginBottom: 4 }}>
      {children}
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)', padding: '2px 4px 0' }}>12:00 ✓✓</div>
    </div>
  );
}

const chipVar = { border: '1px solid var(--line)', background: 'var(--card-2)', borderRadius: 3, padding: '0 5px', fontSize: 12, fontFamily: 'monospace', color: 'var(--verde-escuro)' };
const linhaSeg = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, fontSize: 14 };
const rotSeg = { width: 170, color: 'var(--muted)', fontSize: 13 };
