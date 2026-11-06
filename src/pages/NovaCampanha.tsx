import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, CalendarClock, Check, ChevronDown, ChevronUp, Copy, ExternalLink, FileText,
  Image as ImageIcon, Lightbulb, MessageSquareText, Mic, Phone, PhoneCall, Play, Plus, Reply, Save, ShieldCheck, Trash2, Type, Upload, UserRound, UsersRound, Send, Video, X,
} from 'lucide-react';
import { api, erro, fmtNum, ok } from '../lib/api';
import { Card, Carregando, btn, inputStyle } from '../components/ui';

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

const TIPOS: { v: string; label: string; icon: ReactNode; aceita: string; explica: string }[] = [
  { v: 'text', label: 'Só texto', icon: <Type size={20} />, aceita: '', explica: 'Uma mensagem escrita. Pode ter botões embaixo.' },
  { v: 'image', label: 'Foto', icon: <ImageIcon size={20} />, aceita: 'image/*', explica: 'Uma imagem com um texto embaixo (opcional).' },
  { v: 'video', label: 'Vídeo', icon: <Video size={20} />, aceita: 'video/mp4,video/*', explica: 'Um vídeo com um texto embaixo (opcional).' },
  { v: 'audio', label: 'Áudio', icon: <Mic size={20} />, aceita: 'audio/*', explica: 'Chega como se você tivesse gravado na hora.' },
  { v: 'document', label: 'Arquivo', icon: <FileText size={20} />, aceita: '', explica: 'PDF, planilha, catálogo… com um texto (opcional).' },
  { v: 'poll', label: 'Enquete', icon: <BarChart3 size={20} />, aceita: '', explica: 'Uma pergunta com opções pra pessoa marcar.' },
];
const TIPO_BOTAO: Record<Botao['type'], { label: string; icon: ReactNode; campo?: string; placeholder?: string }> = {
  quick_reply: { label: 'Resposta rápida', icon: <Reply size={14} /> },
  cta_url: { label: 'Abrir um site', icon: <ExternalLink size={14} />, campo: 'Endereço do site', placeholder: 'https://seusite.com.br' },
  cta_call: { label: 'Ligar pra você', icon: <Phone size={14} />, campo: 'Seu telefone', placeholder: '(91) 98888-7777' },
  cta_copy: { label: 'Copiar um código', icon: <Copy size={14} />, campo: 'Código (ex.: cupom)', placeholder: 'CUPOM10' },
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PASSOS = ['O que enviar', 'Mensagem', 'Pra quem', 'Quando', 'Revisar'];

function Chave({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.45, cursor: 'pointer' }}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3 }} /> <span>{children}</span></label>;
}
function Pergunta({ titulo, texto }: { titulo: string; texto?: ReactNode }) {
  return <div style={{ marginBottom: 16 }}><h2 style={{ margin: 0, fontSize: 21 }}>{titulo}</h2>{texto && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>{texto}</p>}</div>;
}
function Dica({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: '#FFF8E6', border: '1px solid #F7E2B0', borderRadius: 6, fontSize: 13, lineHeight: 1.5, color: '#5C4813', marginTop: 12 }}><Lightbulb size={16} color="#B7791F" style={{ flex: 'none', marginTop: 1 }} /><span>{children}</span></div>;
}
function Escolha({ ativo, onClick, icone, titulo, texto, exemplo }: { ativo: boolean; onClick: () => void; icone: ReactNode; titulo: string; texto: string; exemplo?: string }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: '1 1 240px', textAlign: 'left', display: 'flex', gap: 14, padding: 16, borderRadius: 8, border: `2px solid ${ativo ? 'var(--verde)' : 'var(--line)'}`, background: ativo ? 'var(--verde-soft)' : 'var(--card)', position: 'relative' }}>
      <span style={{ width: 44, height: 44, borderRadius: 10, background: ativo ? 'var(--verde)' : 'var(--card-2)', color: ativo ? '#fff' : 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icone}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 16 }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>{texto}</span>
        {exemplo && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--verde-escuro)', marginTop: 6 }}>Ex.: {exemplo}</span>}
      </span>
      {ativo && <span style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 99, background: 'var(--verde)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Check size={14} /></span>}
    </button>
  );
}

/** Texto como ficaria pra um contato de exemplo (formatação do WhatsApp). */
function previaTexto(t: string) {
  const amostra = t.replace(/\{primeiro_nome\}/gi, 'Maria').replace(/\{nome\}/gi, 'Maria Silva').replace(/\{([^{}]*\|[^{}]*)\}/g, (_, o: string) => o.split('|')[0]);
  const esc = amostra.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

const agoraLocal = (minutos = 0) => { const d = new Date(Date.now() + minutos * 60_000 - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) };
const nomePadrao = () => 'Campanha de ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function NovaCampanha() {
  const nav = useNavigate();
  const [passo, setPasso] = useState(0);
  const [conns, setConns] = useState<Conexao[] | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [resumo, setResumo] = useState({ total: 0, optOut: 0, invalid: 0 });

  const [nome, setNome] = useState(nomePadrao());
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
  const [publico, setPublico] = useState<'all' | 'cats' | 'grupos'>('all');
  const [extras, setExtras] = useState<number[]>([]); // outros números (rodízio de chips)
  const [grupos, setGrupos] = useState<{ jid: string; name: string; participants: number }[] | null>(null);
  const [carregandoGrupos, setCarregandoGrupos] = useState(false);
  const [gruposSel, setGruposSel] = useState<{ jid: string; name: string }[]>([]);
  const [buscaGrupo, setBuscaGrupo] = useState('');
  const [marcarTodos, setMarcarTodos] = useState(false);
  const [telTeste, setTelTeste] = useState(() => { try { return localStorage.getItem('telefone_teste') || '' } catch { return '' } });
  const [testando, setTestando] = useState(false);
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
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [passo]);

  const ehTexto = kind === 'message' && tipo === 'text';
  const aceita = kind === 'call' ? (callVideo ? 'video/mp4,video/*' : 'audio/*,video/mp4') : TIPOS.find(t => t.v === tipo)?.aceita ?? '';
  const precisaMidia = kind === 'call' || !['text', 'poll'].includes(tipo);
  const usaTexto = kind === 'message' && tipo !== 'audio';
  const qtdPublico = useMemo(() => {
    if (publico === 'grupos') return gruposSel.length;
    const bruto = publico === 'all' ? resumo.total : cats.filter(c => catsSel.includes(c.id)).reduce((s, c) => s + c.total, 0);
    if (publico === 'all') return Math.max(0, bruto - resumo.optOut - (pularSemWhats ? resumo.invalid : 0));
    return bruto;
  }, [publico, resumo, cats, catsSel, pularSemWhats, gruposSel]);
  const conexao = conns?.find(c => c.id === connId);
  const totalBotoes = botoes.length + (botaoSair ? 1 : 0);
  const textoPrincipal = textos[0] || '';
  const opcoesValidas = opcoes.map(o => o.trim()).filter(Boolean);

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

  // o que falta em cada passo (mensagem simples, sem jargão)
  const faltaNoPasso = (p: number): string | null => {
    if (!seg) return 'Carregando…';
    if (p === 1) {
      if (kind === 'call') {
        if (!midia) return callVideo ? 'Escolha o vídeo que vai passar na ligação.' : 'Escolha o áudio que vai tocar na ligação.';
        if (seg.preMsgAtivo && !seg.preMsgs.some(m => m.trim())) return 'Escreva a mensagem que vai antes da ligação (ou desmarque essa opção).';
        return null;
      }
      if (tipo === 'text' && !textoPrincipal.trim()) return 'Escreva a mensagem.';
      if (tipo === 'poll' && !textoPrincipal.trim()) return 'Escreva a pergunta da enquete.';
      if (tipo === 'poll' && opcoesValidas.length < 2) return 'A enquete precisa de pelo menos 2 opções.';
      if (precisaMidia && !midia) return `Escolha ${tipo === 'image' ? 'a foto' : tipo === 'video' ? 'o vídeo' : tipo === 'audio' ? 'o áudio' : 'o arquivo'} que vai ser enviado.`;
      if (ehTexto && totalBotoes > 3) return 'No máximo 3 botões.';
      const b = ehTexto && botoes.find(x => !x.text.trim() || (x.type !== 'quick_reply' && !x.value.trim()));
      if (b) return !b.text.trim() ? 'Todo botão precisa de um texto.' : `Preencha o campo "${TIPO_BOTAO[b.type].campo}" do botão "${b.text}".`;
      return null;
    }
    if (p === 2) {
      if (!connId) return 'Conecte um número de WhatsApp primeiro (menu Conexões).';
      if (publico === 'cats' && !catsSel.length) return 'Escolha pelo menos uma categoria.';
      if (publico === 'grupos' && kind === 'call') return 'Ligação não pode ser feita pra grupo. Escolha contatos.';
      if (publico === 'grupos' && !gruposSel.length) return 'Escolha pelo menos um grupo.';
      if (!qtdPublico) return 'Nenhum contato pra receber. Importe contatos no menu Contatos.';
      return null;
    }
    if (p === 3) {
      if (quando === 'agendar' && !agendada) return 'Escolha a data e a hora.';
      if (quando === 'agendar' && new Date(agendada).getTime() < Date.now() - 60_000) return 'Essa data e hora já passaram.';
      return null;
    }
    if (p === 4 && nome.trim().length < 2) return 'Dê um nome pra campanha.';
    return null;
  };
  const avancar = () => { const f = faltaNoPasso(passo); if (f) return erro(f); setPasso(p => Math.min(4, p + 1)) };

  const salvar = async () => {
    for (let p = 1; p <= 4; p++) { const f = faltaNoPasso(p); if (f) { setPasso(p); return erro(f) } }
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
        connectionIds: extras.filter(x => x !== connId), mentionAll: publico === 'grupos' && marcarTodos,
        audience: publico === 'all' ? { all: true } : publico === 'grupos' ? { groups: gruposSel } : { categoryIds: catsSel },
        start: false, scheduledAt: quando === 'agendar' ? new Date(agendada).toISOString() : null,
      });
      const fora = r.excluded.optOut + r.excluded.noWhatsapp;
      const extra = fora ? ` (${fmtNum(fora)} ficaram de fora: pediram pra sair ou não têm WhatsApp)` : '';
      if (quando === 'agora') {
        try { await api('POST', `/campaigns/${r.campaign.id}/start`); ok(`Campanha iniciada pra ${fmtNum(r.total)} contato(s)${extra}.`) }
        catch (e) { erro(e); ok('A campanha foi salva, mas não começou. Veja o aviso.') }
      } else ok((quando === 'agendar' ? 'Campanha agendada' : 'Campanha salva pra depois') + extra + '.');
      nav(`/campanhas/${r.campaign.id}`);
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };

  const carregarGrupos = async () => {
    if (!connId) return erro('Escolha o número primeiro.');
    setCarregandoGrupos(true);
    try { setGrupos((await api<{ groups: { jid: string; name: string; participants: number }[] }>('GET', `/connections/${connId}/groups`)).groups) }
    catch (e) { erro(e); setPublico('all') } finally { setCarregandoGrupos(false) }
  };
  const enviarTeste = async () => {
    for (const p of [1]) { const f = faltaNoPasso(p); if (f) return erro(f) }
    if (telTeste.replace(/\D/g, '').length < 10) return erro('Digite o seu WhatsApp com DDD.');
    try { localStorage.setItem('telefone_teste', telTeste) } catch { /* */ }
    setTestando(true);
    try {
      await api('POST', '/campaigns/test', {
        kind, connectionId: connId, messageType: kind === 'call' ? 'audio' : tipo, text: usaTexto ? textoPrincipal : '',
        media: midia ? { path: midia.path, name: midia.name, mime: midia.mime } : null, callVideo,
        buttons: ehTexto ? botoes.map(b => ({ type: b.type, text: b.text.trim(), value: b.value.trim() || undefined })) : [],
        optOutButton: ehTexto && botaoSair, footer: ehTexto ? rodape : '', pollOptions: tipo === 'poll' ? opcoesValidas : [], pollMulti: multipla, phone: telTeste,
      });
      ok(kind === 'call' ? 'Ligando pra você agora!' : 'Teste enviado! Confira no seu WhatsApp.');
    } catch (e) { erro(e) } finally { setTestando(false) }
  };

  if (!conns || !seg) return <Carregando />;
  const S = (k: keyof Seg, v: unknown) => setSeg({ ...seg, [k]: v } as Seg);
  const num = (k: keyof Seg, w = 70) => <input type="number" style={{ ...inputStyle, width: w }} value={Number(seg[k])} onChange={e => S(k, Number(e.target.value))} />;
  const mediaSeg = (seg.intervaloMin + seg.intervaloMax) / 2 + (kind === 'call' ? (seg.toqueMin + seg.toqueMax) / 4 : 4);
  const porHora = Math.min(seg.limiteHora, 3600 / Math.max(1, mediaSeg));
  const horasDuracao = qtdPublico / Math.max(1, porHora);
  const diasDuracao = Math.ceil(qtdPublico / Math.max(1, seg.limiteDia));
  const estimativa = !qtdPublico ? '—' : horasDuracao < 1 ? `cerca de ${Math.max(1, Math.round(horasDuracao * 60))} minutos` : diasDuracao > 1 ? `cerca de ${diasDuracao} dias (até ${seg.limiteDia} por dia, pra proteger o número)` : `cerca de ${horasDuracao.toFixed(1).replace('.', ',')} horas`;
  const tipoAtual = TIPOS.find(t => t.v === tipo)!;
  const oQue = kind === 'call' ? `uma ligação de ${callVideo ? 'vídeo' : 'voz'} que toca ${midia ? `“${midia.name}”` : 'o arquivo escolhido'}` : tipo === 'poll' ? 'uma enquete' : tipo === 'text' ? 'uma mensagem de texto' : `${tipoAtual.label.toLowerCase() === 'foto' ? 'uma foto' : tipoAtual.label.toLowerCase() === 'arquivo' ? 'um arquivo' : 'um ' + tipoAtual.label.toLowerCase()}`;

  return (
    <>
      <Link to="/campanhas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}><ArrowLeft size={15} /> Voltar pras campanhas</Link>
      <h1 style={{ fontSize: 22, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Nova campanha</h1>

      {/* trilha dos passos */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, overflowX: 'auto', paddingBottom: 2 }}>
        {PASSOS.map((p, i) => {
          const feito = i < passo, atual = i === passo;
          return (
            <button key={p} type="button" onClick={() => { if (i <= passo) setPasso(i); else { for (let k = passo; k < i; k++) { const f = faltaNoPasso(k); if (f) { setPasso(k); return erro(f) } } setPasso(i) } }}
              style={{ flex: '1 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 6, border: `1px solid ${atual ? 'var(--verde)' : 'var(--line)'}`, background: atual ? 'var(--verde-soft)' : 'var(--card)', color: atual ? 'var(--verde-escuro)' : feito ? 'var(--ink)' : 'var(--muted)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, background: feito ? 'var(--verde)' : atual ? 'var(--teal)' : '#E3E6E8', color: feito || atual ? '#fff' : 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{feito ? <Check size={13} /> : i + 1}</span>
              {p}
            </button>
          );
        })}
      </div>

      {conns.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--alerta-soft)', border: '1px solid #F7D9A4', borderRadius: 4, marginBottom: 14, fontSize: 14, flexWrap: 'wrap' }}>
          <AlertTriangle size={18} color="#9A6100" /> <span style={{ flex: 1 }}>Antes de criar uma campanha, conecte o número de WhatsApp que vai fazer os envios.</span>
          <Link to="/conexoes" style={btn('ghost', { minHeight: 32 })}>Conectar número</Link>
        </div>
      )}

      <div className="grid-camp">
        <div style={{ minWidth: 0 }}>
          <Card>
            {/* PASSO 1 — o que enviar */}
            {passo === 0 && (
              <>
                <Pergunta titulo="O que você quer enviar?" texto="Escolha se os contatos vão receber uma mensagem no WhatsApp ou uma ligação." />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Escolha ativo={kind === 'message'} onClick={() => { setKind('message'); setMidia(null) }} icone={<MessageSquareText size={22} />} titulo="Mensagem no WhatsApp" texto="Texto, foto, vídeo, áudio, arquivo ou enquete." exemplo="“Oi Maria! Temos uma promoção pra você…”" />
                  <Escolha ativo={kind === 'call'} onClick={() => { setKind('call'); setMidia(null) }} icone={<PhoneCall size={22} />} titulo="Ligação pelo WhatsApp" texto="O WhatsApp da pessoa toca e, quando ela atende, ouve uma gravação sua." exemplo="um recado gravado de 30 segundos" />
                </div>
                {kind === 'message' && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '22px 0 10px' }}>Que tipo de mensagem?</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
                      {TIPOS.map(t => (
                        <button key={t.v} type="button" onClick={() => { setTipo(t.v); setMidia(null) }}
                          style={{ textAlign: 'left', padding: 12, borderRadius: 8, border: `2px solid ${tipo === t.v ? 'var(--verde)' : 'var(--line)'}`, background: tipo === t.v ? 'var(--verde-soft)' : 'var(--card)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14.5, color: tipo === t.v ? 'var(--verde-escuro)' : 'var(--ink)' }}>{t.icon} {t.label}</span>
                          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{t.explica}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {kind === 'call' && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 14, margin: '22px 0 10px' }}>Ligação de voz ou de vídeo?</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Escolha ativo={!callVideo} onClick={() => { setCallVideo(false); setMidia(null) }} icone={<Mic size={20} />} titulo="Voz" texto="A pessoa ouve um áudio gravado (MP3, gravação do celular…)." />
                      <Escolha ativo={callVideo} onClick={() => { setCallVideo(true); setMidia(null) }} icone={<Video size={20} />} titulo="Vídeo" texto="A pessoa vê um vídeo (MP4) na chamada de vídeo." />
                    </div>
                  </>
                )}
              </>
            )}

            {/* PASSO 2 — a mensagem */}
            {passo === 1 && (
              <>
                <Pergunta titulo={kind === 'call' ? 'Escolha a gravação' : tipo === 'poll' ? 'Monte a enquete' : tipo === 'text' ? 'Escreva a mensagem' : `Escolha ${tipo === 'image' ? 'a foto' : tipo === 'video' ? 'o vídeo' : tipo === 'audio' ? 'o áudio' : 'o arquivo'}`}
                  texto={kind === 'call' ? 'É o que a pessoa vai ouvir (ou ver) quando atender. A ligação desliga sozinha quando a gravação acaba.' : 'Do lado direito você vê como vai chegar no celular da pessoa.'} />

                {precisaMidia && (midia ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card-2)', marginBottom: 16 }}>
                    {midia.mime.startsWith('image/') ? <img src={midia.preview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
                      : <span style={{ width: 56, height: 56, borderRadius: 6, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{midia.mime.startsWith('video/') ? <Video size={24} /> : midia.mime.startsWith('audio/') ? <Mic size={24} /> : <FileText size={24} />}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{midia.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(midia.size / 1024 / 1024).toFixed(2)} MB</div>
                      {midia.mime.startsWith('audio/') && <audio src={midia.preview} controls style={{ height: 32, marginTop: 6, maxWidth: '100%' }} />}
                    </div>
                    <button type="button" onClick={() => setMidia(null)} style={btn('ghost', { minHeight: 32 })}>Trocar</button>
                  </div>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 26, border: '2px dashed #B9C4C9', borderRadius: 8, cursor: 'pointer', background: 'var(--card-2)', marginBottom: 16, textAlign: 'center' }}>
                    {enviandoArq ? <Carregando texto="Enviando arquivo…" /> : <>
                      <Upload size={28} color="var(--verde-escuro)" />
                      <strong style={{ fontSize: 15 }}>Clique aqui pra escolher {kind === 'call' ? (callVideo ? 'o vídeo' : 'o áudio') : tipo === 'image' ? 'a foto' : tipo === 'video' ? 'o vídeo' : tipo === 'audio' ? 'o áudio' : 'o arquivo'}</strong>
                      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{kind === 'call' ? (callVideo ? 'Arquivo MP4.' : 'MP3, OGG, WAV ou áudio gravado no celular.') : 'Até 64 MB. Vídeos de até 16 MB chegam com melhor qualidade.'}</span>
                    </>}
                    <input type="file" accept={aceita} style={{ display: 'none' }} disabled={enviandoArq} onChange={e => { enviarArquivo(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                ))}

                {usaTexto && (
                  <>
                    {tipo !== 'poll' && textos.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {textos.map((_, i) => (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: `1px solid ${versaoAtiva === i ? 'var(--verde)' : 'var(--line)'}`, background: versaoAtiva === i ? 'var(--verde-soft)' : 'var(--card)' }}>
                            <button type="button" onClick={() => setVersaoAtiva(i)} style={{ border: 'none', background: 'none', padding: '6px 10px', fontSize: 13, fontWeight: 700, color: versaoAtiva === i ? 'var(--verde-escuro)' : 'var(--ink)' }}>Jeito {i + 1}</button>
                            {i > 0 && <button type="button" title="Apagar este jeito" onClick={() => { setTextos(t => t.filter((_, j) => j !== i)); setVersaoAtiva(0) }} style={{ border: 'none', background: 'none', padding: '0 8px 0 0', color: 'var(--muted)', display: 'flex' }}><X size={13} /></button>}
                          </span>
                        ))}
                      </div>
                    )}
                    <label style={{ display: 'block', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                      {tipo === 'poll' ? 'Pergunta' : tipo === 'text' ? (textos.length > 1 ? `Mensagem — jeito ${versaoAtiva + 1}` : 'Mensagem') : 'Texto embaixo (opcional)'}
                    </label>
                    {tipo !== 'poll' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                        <button type="button" style={btnInserir} onClick={() => inserir('{primeiro_nome}')}><UserRound size={13} /> Colocar o nome da pessoa</button>
                        <button type="button" style={btnInserir} onClick={() => inserir('{nome}')}><UserRound size={13} /> Nome completo</button>
                      </div>
                    )}
                    <textarea ref={textoRef} style={{ ...inputStyle, minHeight: tipo === 'poll' ? 60 : 140, resize: 'vertical', lineHeight: 1.5, fontSize: 15 }}
                      value={tipo === 'poll' ? textoPrincipal : textos[versaoAtiva] || ''} onChange={e => (tipo === 'poll' ? setTextos([e.target.value]) : setTexto(e.target.value))} maxLength={4096}
                      placeholder={tipo === 'poll' ? 'Ex.: Qual o melhor horário pra gente te atender?' : 'Ex.: Oi {primeiro_nome}! Tudo bem? Chegou a promoção que você esperava…'} />
                    {tipo !== 'poll' && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Onde aparecer <b>{'{primeiro_nome}'}</b>, cada pessoa vai ver o próprio nome (ex.: “Oi Maria!”). Pra deixar em <b>negrito</b>, coloque entre asteriscos: *promoção*.</div>}

                    {tipo !== 'poll' && (
                      <Dica>
                        <b>Evite bloqueio:</b> escreva a mesma mensagem de 2 ou 3 jeitos diferentes. O sistema alterna entre eles, e o WhatsApp não vê várias mensagens iguais.{' '}
                        {textos.length < 6 && <button type="button" style={btn('link', { minHeight: 0, padding: 0, fontSize: 13 })} onClick={() => { setTextos(t => [...t, '']); setVersaoAtiva(textos.length) }}><Plus size={13} /> Escrever outro jeito</button>}
                      </Dica>
                    )}
                  </>
                )}

                {kind === 'message' && tipo === 'poll' && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Opções de resposta</div>
                    {opcoes.map((o, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input style={inputStyle} value={o} onChange={e => setOpcoes(l => l.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Opção ${i + 1}`} maxLength={100} />
                        {opcoes.length > 2 && <button type="button" title="Apagar opção" onClick={() => setOpcoes(l => l.filter((_, j) => j !== i))} style={btn('ghost', { padding: '0 10px' })}><Trash2 size={14} /></button>}
                      </div>
                    ))}
                    {opcoes.length < 12 && <button type="button" style={btn('link')} onClick={() => setOpcoes(l => [...l, ''])}><Plus size={14} /> Mais uma opção</button>}
                    <div style={{ marginTop: 8 }}><Chave checked={multipla} onChange={setMultipla}>A pessoa pode marcar mais de uma opção</Chave></div>
                  </div>
                )}

                {ehTexto && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Botões embaixo da mensagem <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>(opcional, até 3)</span></div>
                    <p style={{ margin: '4px 0 12px', fontSize: 13, color: 'var(--muted)' }}>A pessoa toca no botão em vez de digitar. A resposta aparece em Conversas.</p>
                    <div style={{ padding: 12, borderRadius: 8, background: 'var(--card-2)', marginBottom: 10 }}>
                      <Chave checked={botaoSair} onChange={v => (v && totalBotoes >= 3 ? erro('Já tem 3 botões. Apague um pra colocar este.') : setBotaoSair(v))}>
                        <b>Botão “Não tenho interesse”</b> (recomendado) — quem tocar não recebe mais suas campanhas. Isso evita que denunciem seu número.
                      </Chave>
                    </div>
                    {botoes.map((b, i) => {
                      const t = TIPO_BOTAO[b.type];
                      const mudar = (patch: Partial<Botao>) => setBotoes(l => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      return (
                        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Botão {i + 1}</span>
                            <button type="button" onClick={() => setBotoes(l => l.filter((_, j) => j !== i))} style={btn('link', { minHeight: 0, padding: 0, color: 'var(--perigo)', fontSize: 13 })}><Trash2 size={13} /> Apagar</button>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <label style={{ flex: '1 1 160px' }}><span style={rotulo}>O que o botão faz</span>
                              <select style={inputStyle} value={b.type} onChange={e => mudar({ type: e.target.value as Botao['type'], value: '' })}>
                                {Object.entries(TIPO_BOTAO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select></label>
                            <label style={{ flex: '1 1 160px' }}><span style={rotulo}>Texto do botão</span><input style={inputStyle} value={b.text} maxLength={25} onChange={e => mudar({ text: e.target.value })} placeholder={b.type === 'quick_reply' ? 'Ex.: Quero saber mais' : b.type === 'cta_url' ? 'Ex.: Ver catálogo' : b.type === 'cta_call' ? 'Ex.: Falar com a loja' : 'Ex.: Copiar cupom'} /></label>
                            {t.campo && <label style={{ flex: '1 1 180px' }}><span style={rotulo}>{t.campo}</span><input style={inputStyle} value={b.value} onChange={e => mudar({ value: e.target.value })} placeholder={t.placeholder} /></label>}
                          </div>
                        </div>
                      );
                    })}
                    {totalBotoes < 3 && <button type="button" style={btn('ghost')} onClick={() => setBotoes(b => [...b, { type: 'quick_reply', text: '', value: '' }])}><Plus size={15} /> Adicionar botão</button>}
                    {(botoes.length > 0 || botaoSair) && (
                      <label style={{ display: 'block', marginTop: 12 }}><span style={rotulo}>Texto pequeno embaixo (opcional)</span><input style={inputStyle} value={rodape} onChange={e => setRodape(e.target.value)} maxLength={60} placeholder="Ex.: Loja Exemplo · segunda a sábado" /></label>
                    )}
                  </div>
                )}

                {kind === 'call' && (
                  <div style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                    <div style={{ padding: 12, borderRadius: 8, background: 'var(--card-2)' }}>
                      <Chave checked={seg.preMsgAtivo} onChange={v => S('preMsgAtivo', v)}>
                        <b>Mandar uma mensagem antes de ligar</b> (recomendado) — a pessoa vê seu nome no WhatsApp e atende mais.
                      </Chave>
                    </div>
                    {seg.preMsgAtivo && (
                      <div style={{ marginTop: 12 }}>
                        <span style={rotulo}>Mensagem que vai antes</span>
                        {(seg.preMsgs.length ? seg.preMsgs : ['']).map((m, i, arr) => (
                          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                            <input style={inputStyle} value={m} onChange={e => S('preMsgs', arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? 'Ex.: Oi {primeiro_nome}! Daqui a pouco te ligo pra falar da promoção 😉' : `Outro jeito de escrever (${i + 1})`} />
                            {arr.length > 1 && <button type="button" title="Apagar" onClick={() => S('preMsgs', arr.filter((_, j) => j !== i))} style={btn('ghost', { padding: '0 10px' })}><Trash2 size={14} /></button>}
                          </div>
                        ))}
                        {seg.preMsgs.length < 5 && <button type="button" style={btn('link')} onClick={() => S('preMsgs', [...(seg.preMsgs.length ? seg.preMsgs : ['']), ''])}><Plus size={14} /> Escrever outro jeito</button>}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14, marginTop: 8 }}>
                          Ligar entre {num('preEsperaMin', 64)} e {num('preEsperaMax', 64)} minutos depois, só se a mensagem foi
                          <select style={{ ...inputStyle, width: 160 }} value={seg.preCondicao} onChange={e => S('preCondicao', e.target.value)}>
                            <option value="sempre">enviada</option><option value="entregue">entregue no celular</option><option value="lida">lida</option><option value="respondeu">respondida</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* PASSO 3 — pra quem */}
            {passo === 2 && (
              <>
                <Pergunta titulo="Pra quem enviar?" texto="Escolha o seu número que vai enviar e quais contatos vão receber." />
                <label style={{ display: 'block', marginBottom: 16 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Enviar pelo número</span>
                  <select style={inputStyle} value={connId} onChange={e => { setConnId(Number(e.target.value) || ''); setGrupos(null); setGruposSel([]); if (publico === 'grupos') setPublico('all') }}>
                    {conns.length === 0 && <option value="">Nenhum número conectado</option>}
                    {conns.map(c => <option key={c.id} value={c.id}>{c.name}{c.connected ? ' — conectado' : ' — desconectado'}</option>)}
                  </select>
                  {conns.length > 1 && (
                    <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--card-2)' }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Usar mais números ao mesmo tempo <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(rodízio de chips, opcional)</span></div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '3px 0 8px' }}>A campanha se divide entre os números: termina mais rápido e cada número envia menos (menos risco de bloqueio).</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {conns.filter(c => c.id !== connId).map(c => {
                          const on = extras.includes(c.id);
                          return <button key={c.id} type="button" onClick={() => setExtras(l => (on ? l.filter(x => x !== c.id) : [...l, c.id]))}
                            style={{ padding: '7px 12px', borderRadius: 6, border: `2px solid ${on ? 'var(--verde)' : 'var(--line)'}`, background: on ? 'var(--verde-soft)' : 'var(--card)', color: on ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 13.5, fontWeight: 700 }}>
                            {on ? '✓ ' : ''}{c.name}{c.connected ? '' : ' (desconectado)'}</button>;
                        })}
                      </div>
                    </div>
                  )}
                  {conexao && !conexao.connected && <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: '#9A6100' }}>Esse número está desconectado. Dá pra continuar: a campanha espera até você conectar em Conexões.</span>}
                </label>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Quem vai receber</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Escolha ativo={publico === 'all'} onClick={() => setPublico('all')} icone={<UserRound size={20} />} titulo="Todos os contatos" texto={`${fmtNum(resumo.total)} contato(s) na sua lista.`} />
                  <Escolha ativo={publico === 'cats'} onClick={() => (cats.length ? setPublico('cats') : erro('Você ainda não tem categorias. Crie em Contatos › Categorias.'))} icone={<Check size={20} />} titulo="Só algumas categorias" texto="Ex.: só os clientes VIP." />
                  {kind === 'message' && <Escolha ativo={publico === 'grupos'} onClick={() => { setPublico('grupos'); if (!grupos) void carregarGrupos() }} icone={<UsersRound size={20} />} titulo="Grupos do WhatsApp" texto="A mensagem vai DENTRO dos grupos que você escolher." />}
                </div>
                {publico === 'grupos' && (
                  <div style={{ marginTop: 12 }}>
                    {carregandoGrupos ? <Carregando texto="Buscando seus grupos…" /> : grupos && (
                      <>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                          <input style={{ ...inputStyle, flex: '1 1 200px' }} placeholder="Buscar grupo" value={buscaGrupo} onChange={e => setBuscaGrupo(e.target.value)} />
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{gruposSel.length} de {grupos.length} escolhido(s)</span>
                        </div>
                        {grupos.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>Esse número não está em nenhum grupo.</p> : (
                          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                            {grupos.filter(g => g.name.toLowerCase().includes(buscaGrupo.toLowerCase())).map(g => {
                              const on = gruposSel.some(x => x.jid === g.jid);
                              return (
                                <label key={g.jid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--verde-soft)' : 'transparent' }}>
                                  <input type="checkbox" checked={on} onChange={() => setGruposSel(l => (on ? l.filter(x => x.jid !== g.jid) : [...l, { jid: g.jid, name: g.name }]))} />
                                  <span style={{ flex: 1, fontSize: 14, fontWeight: on ? 700 : 400 }}>{g.name}</span>
                                  <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{g.participants} pessoas</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ marginTop: 10 }}><Chave checked={marcarTodos} onChange={setMarcarTodos}>Marcar todos os participantes (@todos) — todo mundo do grupo recebe o aviso</Chave></div>
                      </>
                    )}
                  </div>
                )}
                {publico === 'cats' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {cats.map(c => {
                      const on = catsSel.includes(c.id);
                      return <button key={c.id} type="button" onClick={() => setCatsSel(s => (on ? s.filter(x => x !== c.id) : [...s, c.id]))}
                        style={{ padding: '8px 12px', borderRadius: 6, border: `2px solid ${on ? c.color : 'var(--line)'}`, background: on ? c.color + '1A' : 'var(--card)', color: on ? c.color : 'var(--ink)', fontSize: 13.5, fontWeight: 700 }}>
                        {on ? '✓ ' : ''}{c.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{fmtNum(c.total)}</span></button>;
                    })}
                  </div>
                )}
                {publico !== 'grupos' && <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                  <Chave checked={pularSemWhats} onChange={setPularSemWhats}>Não enviar pra números que não têm WhatsApp (recomendado)</Chave>
                  {resumo.optOut > 0 && <div style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 24 }}>{fmtNum(resumo.optOut)} pessoa(s) pediram pra não receber e ficam de fora automaticamente.</div>}
                </div>}
                {resumo.total === 0 && <Dica>Sua lista de contatos está vazia. <Link to="/contatos">Clique aqui pra importar seus contatos</Link> e depois volte pra cá.</Dica>}
              </>
            )}

            {/* PASSO 4 — quando */}
            {passo === 3 && (
              <>
                <Pergunta titulo="Quando enviar?" />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Escolha ativo={quando === 'agora'} onClick={() => setQuando('agora')} icone={<Play size={20} />} titulo="Começar agora" texto="Os envios começam assim que você confirmar." />
                  <Escolha ativo={quando === 'agendar'} onClick={() => setQuando('agendar')} icone={<CalendarClock size={20} />} titulo="Agendar" texto="Escolha o dia e a hora. Começa sozinho." />
                  <Escolha ativo={quando === 'rascunho'} onClick={() => setQuando('rascunho')} icone={<Save size={20} />} titulo="Só salvar" texto="Fica guardada pra você começar depois." />
                </div>
                {quando === 'agendar' && (
                  <label style={{ display: 'block', marginTop: 14 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Dia e hora</span>
                    <input type="datetime-local" style={{ ...inputStyle, maxWidth: 280 }} value={agendada} min={agoraLocal()} onChange={e => setAgendada(e.target.value)} /></label>
                )}

                <div style={{ marginTop: 22, border: '1px solid #BDE9D6', background: 'var(--verde-soft)', borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: 'var(--verde-escuro)' }}><ShieldCheck size={18} /> Proteção do seu número já está ligada</div>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink)' }}>
                    <li>Envia aos poucos, com uma pausa de {seg.intervaloMin} a {seg.intervaloMax} segundos entre cada {kind === 'call' ? 'ligação' : 'mensagem'}, como uma pessoa faria.</li>
                    <li>Só envia das <b>{seg.horarioInicio}</b> às <b>{seg.horarioFim}</b>, {seg.diasSemana.length === 7 ? 'todos os dias' : seg.diasSemana.map(d => DIAS[d]).join(', ')}. Fora disso, espera e continua sozinho.</li>
                    <li>No máximo {seg.limiteDia} por dia{seg.aquecimento ? '; número novo começa com menos e vai aumentando' : ''}.</li>
                    <li>Se o WhatsApp mostrar sinal de bloqueio, para sozinho e continua quando liberar.</li>
                  </ul>
                  <button type="button" style={btn('link', { marginTop: 6, padding: 0 })} onClick={() => setSegAberta(a => !a)}>{segAberta ? <><ChevronUp size={15} /> Esconder ajustes</> : <><ChevronDown size={15} /> Ajustar (só se você souber o que está fazendo)</>}</button>
                  {segAberta && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 12, background: 'var(--card)', borderRadius: 6, padding: 12 }}>
                      <div style={linhaSeg}><span style={rotSeg}>Pausa entre envios</span>{num('intervaloMin')} a {num('intervaloMax')} segundos</div>
                      <div style={linhaSeg}><span style={rotSeg}>Descanso maior</span>a cada {num('pausaCadaMin', 60)} a {num('pausaCadaMax', 60)} envios, pausa de {num('pausaMin', 60)} a {num('pausaMax', 60)} min</div>
                      <div style={linhaSeg}><span style={rotSeg}>Máximo por número</span>{num('limiteHora')} por hora · {num('limiteDia', 80)} por dia</div>
                      <div style={linhaSeg}><span style={rotSeg}>Horário</span>
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
                        <Chave checked={seg.aquecimento} onChange={v => S('aquecimento', v)}>Número novo começa devagar e aumenta a cada dia</Chave>
                        <Chave checked={seg.verificarWhatsapp} onChange={v => S('verificarWhatsapp', v)}>Conferir se o contato tem WhatsApp antes de enviar</Chave>
                        <Chave checked={seg.pularEmConversa} onChange={v => S('pularEmConversa', v)}>Não enviar pra quem está conversando com a equipe (últimos 3 dias)</Chave>
                        {kind === 'message' && <Chave checked={digitando} onChange={setDigitando}>Aparecer “digitando…” antes de cada mensagem</Chave>}
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>Alguns valores têm limite definido pelo administrador; se passar, o sistema ajusta sozinho.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* PASSO 5 — revisar */}
            {passo === 4 && (
              <>
                <Pergunta titulo="Confira antes de enviar" />
                <label style={{ display: 'block', marginBottom: 16 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Nome da campanha <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(só você vê)</span></span>
                  <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} maxLength={120} /></label>
                <div style={{ display: 'grid', gap: 0, border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  {[
                    ['O que vai ser enviado', `${oQue[0].toUpperCase()}${oQue.slice(1)}${ehTexto && totalBotoes ? ` com ${totalBotoes} botão(ões)` : ''}${usaTexto && tipo !== 'poll' && textos.filter(t => t.trim()).length > 1 ? `, escrita de ${textos.filter(t => t.trim()).length} jeitos` : ''}.`, 1],
                    ['Pra quem', `${publico === 'grupos' ? `${fmtNum(qtdPublico)} grupo(s): ${gruposSel.map(g => g.name).join(', ')}${marcarTodos ? ' (marcando todos)' : ''}` : `${fmtNum(qtdPublico)} contato(s)${publico === 'cats' ? ` das categorias ${cats.filter(c => catsSel.includes(c.id)).map(c => c.name).join(', ')}` : ''}`}, pelo${extras.filter(x => x !== connId).length ? 's números' : ' número'} “${[conexao?.name, ...conns.filter(c => extras.includes(c.id) && c.id !== connId).map(c => c.name)].filter(Boolean).join('”, “')}”.`, 2],
                    ['Quando', quando === 'agora' ? 'Começa assim que você confirmar.' : quando === 'agendar' ? `Começa ${new Date(agendada).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : 'Fica salva; você começa quando quiser.', 3],
                    ['Quanto tempo leva', `Com a proteção do número, ${estimativa}.`, 3],
                  ].map(([k, v, p], i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 'none', alignItems: 'flex-start' }}>
                      <Check size={18} color="var(--verde)" style={{ flex: 'none', marginTop: 2 }} />
                      <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{k}</div><div style={{ fontSize: 14.5, marginTop: 2 }}>{v}</div></div>
                      <button type="button" style={btn('link', { minHeight: 0, padding: 0, fontSize: 13 })} onClick={() => setPasso(p as number)}>Mudar</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: 14, borderRadius: 8, border: '1px dashed var(--verde)', background: 'var(--verde-soft)' }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>Quer ver como chega antes?</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', margin: '3px 0 10px' }}>{kind === 'call' ? 'O sistema liga pro seu WhatsApp tocando a gravação.' : 'O sistema manda a mensagem pro seu WhatsApp, com foto e botões, igual vai chegar nos contatos.'}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input style={{ ...inputStyle, flex: '1 1 200px', background: '#fff' }} value={telTeste} onChange={e => setTelTeste(e.target.value)} placeholder="Seu WhatsApp com DDD" inputMode="tel" />
                    <button type="button" style={btn('ghost', { background: '#fff' })} disabled={testando} onClick={enviarTeste}>{kind === 'call' ? <PhoneCall size={15} /> : <Send size={15} />} {testando ? 'Enviando…' : kind === 'call' ? 'Ligar pra mim' : 'Enviar teste pra mim'}</button>
                  </div>
                </div>
              </>
            )}

            {/* navegação */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              {passo > 0 ? <button type="button" style={btn('ghost')} onClick={() => setPasso(p => p - 1)}><ArrowLeft size={15} /> Voltar</button> : <span />}
              {passo < 4
                ? <button type="button" style={btn('primary', { minWidth: 160 })} onClick={avancar}>Continuar <ArrowRight size={15} /></button>
                : <button type="button" style={btn('primary', { minWidth: 200 })} disabled={salvando} onClick={salvar}>
                  {quando === 'agora' ? <><Play size={15} /> {salvando ? 'Iniciando…' : 'Começar campanha'}</> : quando === 'agendar' ? <><CalendarClock size={15} /> {salvando ? 'Agendando…' : 'Agendar campanha'}</> : <><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar campanha'}</>}
                </button>}
            </div>
          </Card>
        </div>

        <div style={{ position: 'sticky', top: 76 }}>
          <Card title="Como vai chegar no celular">
            <div style={{ background: '#EFEAE2', backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px', borderRadius: 8, padding: 14, minHeight: 150 }}>
              {kind === 'call' ? (
                <>
                  {seg.preMsgAtivo && seg.preMsgs[0] && <Balao><div style={{ padding: '4px 6px 0', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: previaTexto(seg.preMsgs[0]) }} /></Balao>}
                  <div style={{ textAlign: 'center', padding: '14px 0 4px', color: 'var(--teal)' }}>
                    <div style={{ width: 60, height: 60, borderRadius: 99, background: 'var(--teal)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>{callVideo ? <Video size={24} /> : <PhoneCall size={24} />}</div>
                    <div style={{ fontWeight: 700 }}>Chamada de {callVideo ? 'vídeo' : 'voz'} do WhatsApp</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{midia ? `Quando atender, ouve “${midia.name}”` : 'Escolha a gravação no passo 2'}</div>
                  </div>
                </>
              ) : (
                <>
                  <Balao>
                    {midia && tipo === 'image' && <img src={midia.preview} alt="" style={{ width: '100%', borderRadius: 6, display: 'block' }} />}
                    {midia && tipo === 'video' && <video src={midia.preview} style={{ width: '100%', borderRadius: 6, display: 'block' }} controls />}
                    {tipo === 'audio' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px' }}><Play size={20} color="var(--muted)" /><div style={{ flex: 1, height: 3, background: '#9FB3A9', borderRadius: 99 }} /><Mic size={16} color="var(--verde)" /></div>}
                    {tipo === 'document' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'rgba(0,0,0,.05)', borderRadius: 6 }}><FileText size={22} color="#E5484D" /><span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{midia?.name || 'arquivo.pdf'}</span></div>}
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
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.5 }}>Exemplo com o nome “Maria”. Cada pessoa recebe com o próprio nome.</p>
            <div style={{ fontSize: 14, marginTop: 10, lineHeight: 1.8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Vai pra</span><b>{fmtNum(qtdPublico)} contato(s)</b></div>
            </div>
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

const btnInserir = { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--verde)', background: 'var(--verde-soft)', color: 'var(--verde-escuro)', borderRadius: 99, padding: '4px 10px', fontSize: 12.5, fontWeight: 700 };
const rotulo = { display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 };
const linhaSeg = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, fontSize: 14 };
const rotSeg = { width: 150, color: 'var(--muted)', fontSize: 13 };
