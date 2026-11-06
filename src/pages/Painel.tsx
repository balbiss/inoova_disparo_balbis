import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCheck, Hourglass, Megaphone, MessageCircle, PauseCircle, PhoneCall, Plus, Smartphone, UsersRound } from 'lucide-react';
import { api, erro, fmtNum, fmtTel, getUsuario } from '../lib/api';
import { Carregando } from '../components/ui';
import { Avatar } from '../components/Avatar';

type Ativa = { id: number; name: string; kind: string; status: string; pauseReason: string | null; waitReason: string | null; scheduledAt: string | null; total: number; feitos: number; respostas: number };
type Dados = {
  contatos: number;
  conexoes: { total: number; conectadas: number };
  hoje: { enviadas: number; atendidas: number; falhas: number };
  respostasHoje: number; naoLidas: number;
  ativas: Ativa[];
  dias: { dia: string; enviadas: number; ligacoes: number; falhas: number }[];
};
type Conexao = { id: number; name: string; phone: string | null; connected: boolean; avatarUrl?: string | null; seguranca?: { dia: number; limiteDia: number; pausedUntil: string | null } };
type Resposta = { id: number; name: string; waName: string | null; phone: string; avatarUrl: string | null; lastPreview: string; lastMessageAt: string; unread: number; campaignName: string | null };

// paleta validada (dataviz: CVD, contraste e brilho ok no fundo claro)
const COR = { msg: '#008069', lig: '#3B82F6', falha: '#E5484D' };

const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' };
const quando = (d: string) => {
  const dt = new Date(d);
  if (dt.toDateString() === new Date().toDateString()) return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

function Bloco({ titulo, acao, children, style }: { titulo: string; acao?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 18, boxShadow: '0 1px 2px rgba(11,20,26,.04)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Indicador({ icone, cor, valor, rotulo, detalhe, to }: { icone: ReactNode; cor: string; valor: string; rotulo: string; detalhe?: ReactNode; to?: string }) {
  const corpo = (
    <div className="kpi" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', height: '100%', boxShadow: '0 1px 2px rgba(11,20,26,.04)', transition: 'box-shadow .15s, transform .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: cor + '18', color: cor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{icone}</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>{rotulo}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em', color: 'var(--ink)' }}>{valor}</div>
      {detalhe && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{detalhe}</div>}
    </div>
  );
  return to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{corpo}</Link> : corpo;
}

/** Barras empilhadas dos últimos 7 dias, com grade, eixo, legenda com totais e detalhe no hover. */
function GraficoSemana({ dias }: { dias: Dados['dias'] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const totais = dias.map(d => d.enviadas + d.ligacoes + d.falhas);
  const maxBruto = Math.max(1, ...totais);
  const passo = maxBruto <= 5 ? 1 : maxBruto <= 20 ? 5 : maxBruto <= 100 ? 20 : Math.pow(10, Math.floor(Math.log10(maxBruto))) / 2;
  const max = Math.ceil(maxBruto / passo) * passo;
  const ticks = Array.from({ length: Math.round(max / passo) + 1 }, (_, i) => i * passo).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  const W = 560, H = 210, padL = 34, padB = 26, padT = 10;
  const larg = (W - padL) / dias.length;
  const barra = Math.min(38, larg * 0.5);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const soma = { msg: dias.reduce((s, d) => s + d.enviadas, 0), lig: dias.reduce((s, d) => s + d.ligacoes, 0), falha: dias.reduce((s, d) => s + d.falhas, 0) };
  const series: [keyof typeof COR, string, number][] = [['msg', 'Mensagens', soma.msg], ['lig', 'Ligações', soma.lig], ['falha', 'Falhas', soma.falha]];

  return (
    <div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        {series.map(([k, nome, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--muted)' }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: COR[k] }} />{nome} <b style={{ color: 'var(--ink)' }}>{fmtNum(v)}</b>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Envios dos últimos 7 dias" style={{ display: 'block', overflow: 'visible' }}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#E9EDEF" strokeDasharray={t ? '3 4' : undefined} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8696A0">{t}</text>
            </g>
          ))}
          {dias.map((d, i) => {
            const cx = padL + larg * i + larg / 2;
            const partes: [keyof typeof COR, number][] = [['msg', d.enviadas], ['lig', d.ligacoes], ['falha', d.falhas]];
            let base = 0;
            const visiveis = partes.filter(p => p[1] > 0);
            const dt = new Date(d.dia + 'T12:00:00');
            const hoje = dt.toDateString() === new Date().toDateString();
            return (
              <g key={d.dia} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)}>
                <rect x={padL + larg * i} y={padT} width={larg} height={H - padT - padB} fill={foco === i ? 'rgba(0,128,105,.05)' : 'transparent'} rx={6} />
                {visiveis.map(([k, v], j) => {
                  const y0 = y(base), y1 = y(base + v);
                  base += v;
                  const topo = j === visiveis.length - 1;
                  const h = Math.max(1, y0 - y1 - (topo ? 0 : 2));
                  return topo
                    ? <path key={k} d={`M${cx - barra / 2},${y1 + h} V${y1 + 4} Q${cx - barra / 2},${y1} ${cx - barra / 2 + 4},${y1} H${cx + barra / 2 - 4} Q${cx + barra / 2},${y1} ${cx + barra / 2},${y1 + 4} V${y1 + h} Z`} fill={COR[k]} />
                    : <rect key={k} x={cx - barra / 2} y={y1 + 2} width={barra} height={h} fill={COR[k]} />;
                })}
                {!visiveis.length && <rect x={cx - barra / 2} y={y(0) - 2} width={barra} height={2} rx={1} fill="#D5DCE0" />}
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="11.5" fill={hoje ? 'var(--ink)' : '#8696A0'} fontWeight={hoje ? 700 : 400} style={{ textTransform: 'capitalize' }}>
                  {hoje ? 'Hoje' : dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
                </text>
              </g>
            );
          })}
        </svg>
        {foco !== null && (() => {
          const d = dias[foco];
          const left = `${((padL + larg * foco + larg / 2) / W) * 100}%`;
          return (
            <div style={{ position: 'absolute', left, top: 0, transform: 'translate(-50%, -8px)', background: '#111B21', color: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(0,0,0,.18)', zIndex: 2 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</div>
              {series.map(([k, nome]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: COR[k] }} />{nome}: <b>{k === 'msg' ? d.enviadas : k === 'lig' ? d.ligacoes : d.falhas}</b></div>)}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function SituacaoCampanha({ a }: { a: Ativa }) {
  if (a.status === 'scheduled') return <span style={tag('#1D5FC2', '#EAF2FE')}><CalendarClock size={12} /> Agendada · {a.scheduledAt ? new Date(a.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : ''}</span>;
  if (a.status === 'paused') return <span style={tag('#9A6100', '#FFF6E5')}><PauseCircle size={12} /> Pausada</span>;
  if (a.waitReason) return <span style={tag('#9A6100', '#FFF6E5')} title={a.waitReason}><Hourglass size={12} /> Aguardando</span>;
  return <span style={tag('var(--verde-escuro)', 'var(--verde-soft)')}><i style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--verde)', animation: 'pulse 1.4s infinite' }} /> Enviando</span>;
}
const tag = (c: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: bg, color: c, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' });

export default function Painel() {
  const [d, setD] = useState<Dados | null>(null);
  const [conns, setConns] = useState<Conexao[]>([]);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const u = getUsuario();

  useEffect(() => {
    const carregar = () => {
      api<Dados>('GET', '/dashboard').then(setD).catch(erro);
      api<{ connections: Conexao[] }>('GET', '/connections').then(r => setConns(r.connections)).catch(() => {});
      api<{ conversations: Resposta[] }>('GET', '/conversations?filter=respondidas&per=10').then(r => setRespostas(r.conversations.slice(0, 5))).catch(() => {});
    };
    carregar();
    const t = setInterval(carregar, 20000);
    return () => clearInterval(t);
  }, []);

  const taxa = useMemo(() => (d && d.hoje.enviadas ? Math.round((d.respostasHoje / d.hoje.enviadas) * 100) : null), [d]);
  if (!d) return <Carregando />;
  const primeiroNome = (u?.name || '').split(' ')[0];
  const semNumero = d.conexoes.total === 0;
  const desconectados = d.conexoes.total - d.conexoes.conectadas;
  const totalSemana = d.dias.reduce((s, x) => s + x.enviadas + x.ligacoes, 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      {/* boas-vindas */}
      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, padding: '26px 28px', color: '#fff', background: 'linear-gradient(135deg, #075E54 0%, #0B7A6C 55%, #128C7E 100%)', boxShadow: '0 10px 30px rgba(7,94,84,.18)' }}>
        <div aria-hidden style={{ position: 'absolute', right: -60, top: -80, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,211,102,.35), transparent 70%)' }} />
        <div aria-hidden style={{ position: 'absolute', right: 120, bottom: -120, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,.08), transparent 70%)' }} />
        <div style={{ position: 'relative', display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)', fontWeight: 700 }}>{u?.empresa?.name}</div>
            <h1 style={{ margin: '6px 0 8px', fontSize: 28, fontWeight: 700, letterSpacing: '-.01em' }}>{saudacao()}, {primeiroNome}! 👋</h1>
            <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,.85)', maxWidth: 520, lineHeight: 1.55 }}>
              {d.hoje.enviadas || d.respostasHoje
                ? <>Hoje você já enviou <b>{fmtNum(d.hoje.enviadas)}</b> mensagem(ns) e recebeu <b>{fmtNum(d.respostasHoje)}</b> resposta(s){d.naoLidas ? <>. Tem <b>{d.naoLidas}</b> conversa(s) esperando você.</> : '.'}</>
                : d.ativas.length ? 'Suas campanhas estão em andamento. Acompanhe tudo por aqui.' : 'Que tal começar uma campanha hoje? Leva poucos minutos.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/campanhas/nova" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, background: '#25D366', color: '#073B33', fontWeight: 700, fontSize: 14.5, textDecoration: 'none', boxShadow: '0 6px 16px rgba(37,211,102,.35)' }}><Plus size={17} /> Nova campanha</Link>
            <Link to="/conversas" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 10, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontWeight: 700, fontSize: 14.5, textDecoration: 'none' }}>
              <MessageCircle size={17} /> Conversas{d.naoLidas ? <span style={{ background: '#25D366', color: '#073B33', borderRadius: 99, padding: '0 7px', fontSize: 12 }}>{d.naoLidas}</span> : null}
            </Link>
          </div>
        </div>
      </section>

      {(semNumero || desconectados > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#FFF8E6', border: '1px solid #F7E2B0', borderRadius: 12, fontSize: 14, flexWrap: 'wrap' }}>
          <AlertTriangle size={18} color="#B7791F" style={{ flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 200 }}>{semNumero ? 'Você ainda não conectou nenhum número de WhatsApp. Conecte um pra começar a enviar.' : `${desconectados} número(s) de WhatsApp desconectado(s). As campanhas desses números ficam esperando.`}</span>
          <Link to="/conexoes" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Ir pra Conexões <ArrowRight size={14} /></Link>
        </div>
      )}

      {/* indicadores */}
      <div className="grid-kpi">
        <Indicador icone={<UsersRound size={18} />} cor="#008069" valor={fmtNum(d.contatos)} rotulo="Contatos" detalhe="na sua lista" to="/contatos" />
        <Indicador icone={<CheckCheck size={18} />} cor="#008069" valor={fmtNum(d.hoje.enviadas)} rotulo="Enviadas hoje" detalhe={d.hoje.falhas ? <span style={{ color: COR.falha }}>{d.hoje.falhas} falharam</span> : `${fmtNum(totalSemana)} nos últimos 7 dias`} />
        <Indicador icone={<MessageCircle size={18} />} cor="#7C5CFF" valor={fmtNum(d.respostasHoje)} rotulo="Responderam hoje" detalhe={taxa !== null ? `${taxa}% de quem recebeu hoje` : d.naoLidas ? `${d.naoLidas} não lida(s)` : 'nas Conversas'} to="/conversas" />
        <Indicador icone={<PhoneCall size={18} />} cor={COR.lig} valor={fmtNum(d.hoje.atendidas)} rotulo="Ligações atendidas" detalhe="hoje" />
      </div>

      <div className="grid-painel">
        <Bloco titulo="Atividade dos últimos 7 dias" acao={<Link to="/campanhas" style={{ fontSize: 13, fontWeight: 700 }}>Ver campanhas</Link>}>
          <GraficoSemana dias={d.dias} />
        </Bloco>

        <Bloco titulo="Seus números" acao={<Link to="/conexoes" style={{ fontSize: 13, fontWeight: 700 }}>Gerenciar</Link>}>
          {conns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted)', fontSize: 14 }}>
              <Smartphone size={28} style={{ opacity: .5 }} />
              <p style={{ margin: '8px 0 12px' }}>Nenhum número conectado.</p>
              <Link to="/conexoes" style={{ fontWeight: 700 }}>Conectar agora</Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {conns.map(c => {
                const uso = c.seguranca;
                const pct = uso && uso.limiteDia ? Math.min(100, Math.round((uso.dia / uso.limiteDia) * 100)) : 0;
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                      <Avatar url={c.avatarUrl} nome={c.name} size={44} apagado={!c.connected} icone={<Smartphone size={18} />} />
                      <span style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 99, background: c.connected ? '#25D366' : '#C9D1D5', border: '2px solid #fff' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <span style={{ fontSize: 12, color: c.connected ? 'var(--verde-escuro)' : 'var(--muted)', fontWeight: 700 }}>{c.connected ? (uso?.pausedUntil ? 'Em pausa' : 'Conectado') : 'Desconectado'}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{c.phone ? fmtTel(c.phone) : '—'}</div>
                      {uso && c.connected && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ height: 6, borderRadius: 99, background: '#E9EDEF', overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#F5A524' : 'var(--verde)', borderRadius: 99 }} /></div>
                          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{uso.dia} de {uso.limiteDia} envios hoje</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Bloco>

        <Bloco titulo="Campanhas em andamento" acao={<Link to="/campanhas" style={{ fontSize: 13, fontWeight: 700 }}>Ver todas</Link>}>
          {d.ativas.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0' }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Megaphone size={20} /></span>
              <div style={{ flex: 1, fontSize: 14, color: 'var(--muted)' }}>Nenhuma campanha rodando agora.</div>
              <Link to="/campanhas/nova" style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>Criar campanha</Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {d.ativas.map(a => {
                const pct = a.total ? Math.round((a.feitos / a.total) * 100) : 0;
                return (
                  <Link key={a.id} to={`/campanhas/${a.id}`} className="linha-hover" style={{ display: 'block', padding: '10px 10px', margin: '0 -10px', borderRadius: 10, color: 'inherit', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: a.kind === 'call' ? '#EAF2FE' : 'var(--verde-soft)', color: a.kind === 'call' ? '#1D5FC2' : 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{a.kind === 'call' ? <PhoneCall size={16} /> : <Megaphone size={16} />}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px 8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 120px' }}>{a.name}</span>
                          <SituacaoCampanha a={a} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 99, background: '#E9EDEF', overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: 'var(--verde)', borderRadius: 99, transition: 'width .4s' }} /></div>
                          <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtNum(a.feitos)}/{fmtNum(a.total)}{a.respostas ? ` · ${a.respostas} resp.` : ''}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Bloco>

        <Bloco titulo="Respostas recentes" acao={<Link to="/conversas" style={{ fontSize: 13, fontWeight: 700 }}>Abrir Conversas</Link>}>
          {respostas.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0' }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: '#F1EDFF', color: '#7C5CFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><MessageCircle size={20} /></span>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>Quando alguém responder uma campanha, aparece aqui.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 2 }}>
              {respostas.map(r => (
                <Link key={r.id} to={`/conversas?c=${r.id}`} className="linha-hover" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', margin: '0 -10px', borderRadius: 10, color: 'inherit', textDecoration: 'none' }}>
                  <Avatar url={r.avatarUrl} nome={r.name || r.waName || ''} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.waName || fmtTel(r.phone)}</span>
                      <span style={{ fontSize: 12, color: r.unread ? 'var(--verde)' : 'var(--muted)', fontWeight: r.unread ? 700 : 400 }}>{quando(r.lastMessageAt)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastPreview}</span>
                      {r.unread > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99, background: 'var(--verde)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.unread}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Bloco>
      </div>
    </div>
  );
}
