import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, CheckCheck, Clock, Copy, Download, Hourglass, MessageCircle, MessageSquareText, Pause, PhoneCall, Play, Repeat, ShieldCheck, Trash2 } from 'lucide-react';
import { api, baixar, confirmar, erro, fmtData, fmtNum, fmtTel, getToken, ok } from '../lib/api';
import { Cabecalho, Card, Carregando, Modal, Paginacao, Progresso, btn, inputStyle } from '../components/ui';
import { StatusAlvo, StatusCampanha, TIPO_MSG, feitos, type Stats } from '../lib/status';

type Numero = { nextAt: string | null; pausedUntil: string | null; pauseReason: string | null; hora: number; dia: number; limiteHora: number; limiteDia: number; diaAquecimento: number | null };
type Campanha = {
  id: number; name: string; kind: 'message' | 'call'; status: string; messageType: string; text: string; textVariants: string[]; mediaName: string | null; mediaMime: string | null; hasMedia: boolean;
  callVideo: boolean; pauseReason: string | null; waitReason: string | null; scheduledAt: string | null; buttons: { type: string; text: string }[]; optOutButton: boolean; pollOptions: string[];
  startedAt: string | null; finishedAt: string | null; createdAt: string; connectionName: string | null; stats: Stats; numero: Numero | null;
  seguranca: { intervaloMin: number; intervaloMax: number; limiteHora: number; limiteDia: number; horarioInicio: string; horarioFim: string; preMsgAtivo?: boolean };
};
type Alvo = { id: number; name: string; phone: string; status: string; error: string | null; durationMs: number | null; doneAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null; reply: string | null; optedOut: boolean; conversationId: number | null };

function Numero({ valor, label, cor, total }: { valor: number; label: string; cor?: string; total?: number }) {
  return (
    <div style={{ flex: '1 1 110px', padding: '11px 13px', borderLeft: `3px solid ${cor || 'var(--line)'}`, background: 'var(--card-2)', borderRadius: 3 }}>
      <div style={{ fontSize: 21, fontWeight: 700, color: cor }}>{fmtNum(valor)}{total ? <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}> · {Math.round((valor / total) * 100)}%</span> : null}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

const paraLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) };

export default function CampanhaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Campanha | null>(null);
  const [alvos, setAlvos] = useState<{ targets: Alvo[]; total: number } | null>(null);
  const [filtro, setFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
  const [, setTique] = useState(0);
  const [reenviar, setReenviar] = useState(false);
  const per = 50;

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ page: String(page), per: String(per) });
      if (filtro) p.set('status', filtro);
      const [a, b] = await Promise.all([api<{ campaign: Campanha }>('GET', `/campaigns/${id}`), api<{ targets: Alvo[]; total: number }>('GET', `/campaigns/${id}/targets?${p}`)]);
      setC(a.campaign); setAlvos(b);
    } catch (e) { erro(e) }
  }, [id, page, filtro]);

  useEffect(() => { carregar() }, [carregar]);
  useEffect(() => {
    if (!c || !['running', 'paused', 'scheduled', 'done'].includes(c.status)) return;
    const t = setInterval(carregar, c.status === 'running' ? 4000 : 15000);
    return () => clearInterval(t);
  }, [c?.status, carregar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setTique(x => x + 1), 1000); return () => clearInterval(t) }, []);

  useEffect(() => {
    if (!c?.hasMedia) return;
    let url = '';
    fetch(`/api/campaigns/${c.id}/media`, { headers: { Authorization: 'Bearer ' + getToken() } }).then(r => (r.ok ? r.blob() : null)).then(b => { if (b) { url = URL.createObjectURL(b); setMidiaUrl(url) } });
    return () => { if (url) URL.revokeObjectURL(url) };
  }, [c?.id, c?.hasMedia]);

  const acao = async (caminho: string, msg: string, pergunta?: [string, string, string, boolean?]) => {
    if (pergunta && !(await confirmar(...pergunta))) return;
    try { await api('POST', `/campaigns/${id}/${caminho}`); ok(msg); carregar() } catch (e) { erro(e) }
  };
  const excluir = async () => {
    if (!(await confirmar('Excluir esta campanha?', 'O relatório dela também é apagado.', 'Excluir', true))) return;
    try { await api('DELETE', `/campaigns/${id}`); ok('Campanha excluída.'); nav('/campanhas') } catch (e) { erro(e) }
  };
  const agendar = async () => {
    const r = await Swal.fire({
      title: c?.status === 'scheduled' ? 'Mudar o horário' : 'Agendar campanha', html: '<input id="quando" type="datetime-local" class="swal2-input" style="width:auto">',
      didOpen: () => { const el = document.getElementById('quando') as HTMLInputElement; el.value = c?.scheduledAt ? paraLocal(c.scheduledAt) : paraLocal(new Date(Date.now() + 3600_000).toISOString()) },
      preConfirm: () => (document.getElementById('quando') as HTMLInputElement).value || Swal.showValidationMessage('Escolha a data e a hora'),
      showCancelButton: true, confirmButtonText: 'Agendar', cancelButtonText: 'Cancelar', confirmButtonColor: '#00A884', reverseButtons: true,
    });
    if (!r.isConfirmed) return;
    try { await api('POST', `/campaigns/${id}/schedule`, { scheduledAt: new Date(r.value).toISOString() }); ok('Campanha agendada.'); carregar() } catch (e) { erro(e) }
  };

  if (!c || !alvos) return <Carregando />;
  const s = c.stats;
  const enviados = c.kind === 'call' ? s.completed + s.noAnswer + s.failed : s.sent;
  const prox = c.numero?.nextAt && new Date(c.numero.nextAt).getTime() > Date.now() ? Math.ceil((new Date(c.numero.nextAt).getTime() - Date.now()) / 1000) : null;
  const fmtSeg = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}min ${n % 60}s` : `${n}s`);

  const filtros: [string, string, number][] = c.kind === 'call'
    ? [['', 'Todos', s.total], ['pending', 'Na fila', s.pending], ['completed', 'Atenderam', s.completed], ['no-answer', 'Não atenderam', s.noAnswer], ['replied', 'Responderam', s.replied], ['failed', 'Falharam', s.failed], ['skipped', 'Pulados', s.skipped]]
    : [['', 'Todos', s.total], ['pending', 'Na fila', s.pending], ['sent', 'Enviadas', s.sent], ['read', 'Lidas', s.read], ['replied', 'Responderam', s.replied], ['optedOut', 'Descadastraram', s.optedOut], ['failed', 'Falharam', s.failed], ['skipped', 'Pulados', s.skipped]];

  let botoes: ReactNode = null;
  if (c.status === 'draft') botoes = <><button style={btn()} onClick={() => acao('start', 'Campanha iniciada.')}><Play size={15} /> Iniciar</button><button style={btn('ghost')} onClick={agendar}><CalendarClock size={15} /> Agendar</button></>;
  if (c.status === 'scheduled') botoes = <><button style={btn()} onClick={() => acao('start', 'Campanha iniciada.')}><Play size={15} /> Iniciar agora</button><button style={btn('ghost')} onClick={agendar}><CalendarClock size={15} /> Mudar horário</button><button style={btn('ghost')} onClick={() => acao('pause', 'Agendamento pausado.')}><Pause size={15} /> Pausar</button></>;
  if (c.status === 'running') botoes = <button style={btn('ghost')} onClick={() => acao('pause', 'Campanha pausada.')}><Pause size={15} /> Pausar</button>;
  if (c.status === 'paused') botoes = <><button style={btn()} onClick={() => acao('start', 'Campanha retomada.')}><Play size={15} /> Retomar</button><button style={btn('ghost')} onClick={agendar}><CalendarClock size={15} /> Agendar</button></>;

  return (
    <>
      <Link to="/campanhas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}><ArrowLeft size={15} /> Campanhas</Link>
      <Cabecalho titulo={c.name}>
        <StatusCampanha status={c.status} esperando={!!c.waitReason} />
        {botoes}
        {['draft', 'running', 'paused', 'scheduled'].includes(c.status) && <button style={btn('ghost')} onClick={() => acao('cancel', 'Campanha cancelada.', ['Cancelar a campanha?', 'Quem ainda está na fila não recebe. Não dá pra retomar depois.', 'Cancelar campanha', true])}><Ban size={15} /> Cancelar</button>}
        <button style={btn('ghost')} onClick={() => setReenviar(true)} title="Criar outra campanha a partir desta"><Repeat size={15} /> Reenviar / Duplicar</button>
        {feitos(s) > 0 && <button style={btn('ghost')} onClick={() => baixar(`/campaigns/${c.id}/export`, `campanha-${c.id}.csv`)}><Download size={15} /> Relatório</button>}
        {!['running', 'scheduled'].includes(c.status) && <button style={btn('ghost', { padding: '0 11px' })} title="Excluir campanha" onClick={excluir}><Trash2 size={15} color="var(--perigo)" /></button>}
      </Cabecalho>

      {c.status === 'scheduled' && c.scheduledAt && <Aviso cor="azul" icone={<CalendarClock size={18} />}>Agendada pra <b>{fmtData(c.scheduledAt)}</b>. Começa sozinha nesse horário.</Aviso>}
      {c.status === 'paused' && c.pauseReason && <Aviso cor="amarelo" icone={<AlertTriangle size={18} />}>{c.pauseReason}</Aviso>}
      {c.status === 'running' && c.waitReason && <Aviso cor="amarelo" icone={<Hourglass size={18} />}>{c.waitReason}</Aviso>}

      <div className="grid-camp">
        <div style={{ minWidth: 0 }}>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}><Progresso valor={feitos(s)} total={s.total} /></div>
              <span style={{ fontSize: 14 }}><b>{fmtNum(feitos(s))}</b> de {fmtNum(s.total)} {c.kind === 'call' ? 'ligações' : 'contatos'}</span>
              {c.status === 'running' && !c.waitReason && prox !== null && <span style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={13} /> próximo em {fmtSeg(prox)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Numero valor={s.pending} label="Na fila" />
              {c.kind === 'call' ? <>
                <Numero valor={s.completed} label="Atenderam" cor="var(--verde-escuro)" total={enviados} />
                <Numero valor={s.noAnswer} label="Não atenderam" cor="#54656F" />
              </> : <>
                <Numero valor={s.sent} label="Enviadas" cor="var(--verde-escuro)" />
                <Numero valor={s.delivered} label="Entregues" cor="#54656F" total={s.sent} />
                <Numero valor={s.read} label="Lidas" cor="#1D8FE0" total={s.sent} />
              </>}
              <Numero valor={s.replied} label="Responderam" cor="#7C5CFF" total={enviados} />
              {s.optedOut > 0 && <Numero valor={s.optedOut} label="Descadastraram" cor="#C42B30" />}
              <Numero valor={s.failed} label="Falharam" cor="var(--perigo)" />
              {s.skipped > 0 && <Numero valor={s.skipped} label="Pulados" cor="#9A6100" />}
            </div>
          </Card>

          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }}>
            <div style={{ display: 'flex', gap: 6, padding: 12, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
              {filtros.map(([v, label, n]) => (
                <button key={v} onClick={() => { setFiltro(v); setPage(1) }} style={{ padding: '5px 11px', borderRadius: 99, border: `1px solid ${filtro === v ? 'var(--verde)' : 'var(--line)'}`, background: filtro === v ? 'var(--verde-soft)' : 'var(--card)', color: filtro === v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 13, fontWeight: 700 }}>
                  {label} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{fmtNum(n)}</span>
                </button>
              ))}
            </div>
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Contato</th><th>Situação</th>{c.kind === 'call' && <th>Duração</th>}<th>Resposta</th><th className="esconde-mobile">Quando</th></tr></thead>
                <tbody>
                  {alvos.targets.map(t => (
                    <tr key={t.id}>
                      <td><div style={{ fontWeight: 700 }}>{t.name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Sem nome</span>}</div><div style={{ fontSize: 12.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtTel(t.phone)}</div></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <StatusAlvo status={t.status} />
                          {t.readAt ? <span title={'Lida ' + fmtData(t.readAt)}><CheckCheck size={16} color="#53BDEB" /></span> : t.deliveredAt ? <span title={'Entregue ' + fmtData(t.deliveredAt)}><CheckCheck size={16} color="#8696A0" /></span> : null}
                        </div>
                        {t.error && <div style={{ fontSize: 12, color: t.status === 'skipped' ? 'var(--muted)' : 'var(--perigo)', marginTop: 3, maxWidth: 300 }}>{t.error}</div>}
                      </td>
                      {c.kind === 'call' && <td style={{ fontSize: 13 }}>{t.durationMs ? `${Math.round(t.durationMs / 1000)}s` : '—'}</td>}
                      <td style={{ maxWidth: 280 }}>
                        {t.reply ? (
                          <Link to={t.conversationId ? `/conversas?c=${t.conversationId}` : '/conversas'} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: 'var(--ink)', textDecoration: 'none' }} title="Abrir conversa">
                            <MessageCircle size={14} color="#7C5CFF" style={{ flex: 'none', marginTop: 2 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.reply}</span>
                          </Link>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>}
                        {t.optedOut && <div style={{ fontSize: 11.5, color: '#C42B30', fontWeight: 700, marginTop: 3 }}>DESCADASTROU</div>}
                      </td>
                      <td className="esconde-mobile" style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t.doneAt ? fmtData(t.doneAt) : '—'}</td>
                    </tr>
                  ))}
                  {alvos.targets.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>Ninguém nesta situação.</td></tr>}
                </tbody>
              </table>
            </div>
            <Paginacao page={page} per={per} total={alvos.total} onPage={setPage} />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="Detalhes">
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <Linha k="Tipo" v={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.kind === 'call' ? <PhoneCall size={14} /> : <MessageSquareText size={14} />}{c.kind === 'call' ? `Ligação ${c.callVideo ? 'de vídeo' : 'de áudio'}` : `Mensagem · ${TIPO_MSG[c.messageType]}`}</span>} />
              <Linha k="Número" v={c.connectionName || '—'} />
              {c.textVariants?.length > 0 && <Linha k="Versões do texto" v={c.textVariants.length + 1} />}
              {c.buttons?.length + (c.optOutButton ? 1 : 0) > 0 && <Linha k="Botões" v={[...c.buttons.map(b => b.text), ...(c.optOutButton ? ['Não tenho interesse'] : [])].join(' · ')} />}
              {c.seguranca?.preMsgAtivo && <Linha k="Mensagem antes" v="Sim" />}
              <Linha k="Criada" v={fmtData(c.createdAt)} />
              {c.startedAt && <Linha k="Iniciada" v={fmtData(c.startedAt)} />}
              {c.finishedAt && <Linha k="Terminou" v={fmtData(c.finishedAt)} />}
            </div>
            {midiaUrl && (
              <div style={{ marginTop: 14 }}>
                {c.mediaMime?.startsWith('image/') && <img src={midiaUrl} alt="" style={{ width: '100%', borderRadius: 4 }} />}
                {c.mediaMime?.startsWith('video/') && <video src={midiaUrl} controls style={{ width: '100%', borderRadius: 4 }} />}
                {c.mediaMime?.startsWith('audio/') && <audio src={midiaUrl} controls style={{ width: '100%' }} />}
                {!/^(image|video|audio)\//.test(c.mediaMime || '') && <a href={midiaUrl} download={c.mediaName || 'arquivo'}>{c.mediaName}</a>}
              </div>
            )}
            {c.text && <div style={{ marginTop: 14, padding: 10, background: 'var(--balao)', borderRadius: 6, fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.text}{c.pollOptions?.length > 0 && '\n' + c.pollOptions.map(o => '◯ ' + o).join('\n')}</div>}
          </Card>

          {c.seguranca && (
            <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} /> Segurança</span>}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                <Linha k="Intervalo" v={`${c.seguranca.intervaloMin}–${c.seguranca.intervaloMax} s`} />
                <Linha k="Horário" v={`${c.seguranca.horarioInicio}–${c.seguranca.horarioFim}`} />
                {c.numero && <>
                  <Linha k="Número na última hora" v={`${c.numero.hora} de ${c.numero.limiteHora}`} />
                  <Linha k="Número hoje" v={`${c.numero.dia} de ${c.numero.limiteDia}`} />
                  {c.numero.diaAquecimento && <Linha k="Aquecimento" v={`dia ${c.numero.diaAquecimento}`} />}
                  {c.numero.pausedUntil && <Linha k="Pausa de segurança" v={`até ${new Date(c.numero.pausedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`} />}
                </>}
              </div>
            </Card>
          )}
        </div>
      </div>
      {reenviar && <Reenviar c={c} onClose={() => setReenviar(false)} onCriada={id => { setReenviar(false); nav(`/campanhas/${id}`) }} />}
    </>
  );
}

function Aviso({ cor, icone, children }: { cor: 'amarelo' | 'azul'; icone: ReactNode; children: ReactNode }) {
  const [bg, borda, fg] = cor === 'azul' ? ['var(--info-soft)', '#C5DBF9', '#1D5FC2'] : ['var(--alerta-soft)', '#F7D9A4', '#9A6100'];
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: bg, border: `1px solid ${borda}`, borderRadius: 4, marginBottom: 14, fontSize: 14 }}><span style={{ color: fg, display: 'flex' }}>{icone}</span><span>{children}</span></div>;
}

function Linha({ k, v }: { k: string; v: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}><span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span></div>;
}

/** Cria outra campanha (rascunho) a partir desta: todos, ou só quem não respondeu / não leu / falhou. */
function Reenviar({ c, onClose, onCriada }: { c: Campanha; onClose: () => void; onCriada: (id: number) => void }) {
  const s = c.stats;
  const opcoes: [string, string, string, number][] = c.kind === 'call'
    ? [['nao_atenderam', 'Quem não atendeu', 'Liga de novo pra quem não atendeu.', s.noAnswer], ['nao_responderam', 'Quem não respondeu', 'Todos que receberam e não responderam nada.', Math.max(0, s.completed + s.noAnswer - s.replied)], ['falharam', 'Quem falhou', 'Tenta de novo quem deu erro.', s.failed], ['todos', 'Todos (duplicar)', 'Uma cópia da campanha inteira.', s.total]]
    : [['nao_responderam', 'Quem não respondeu', 'Recebeu, mas não respondeu nada. O mais usado.', Math.max(0, s.sent - s.replied)], ['nao_leram', 'Quem não leu', 'A mensagem chegou mas não foi aberta.', Math.max(0, s.sent - s.read)], ['falharam', 'Quem falhou', 'Tenta de novo quem deu erro no envio.', s.failed], ['todos', 'Todos (duplicar)', 'Uma cópia da campanha inteira.', s.total]];
  const [publico, setPublico] = useState(opcoes[0][0]);
  const [trocar, setTrocar] = useState(false);
  const [texto, setTexto] = useState(c.text);
  const [salvando, setSalvando] = useState(false);
  const podeTexto = c.kind === 'message' && c.messageType !== 'audio';
  const criar = async () => {
    setSalvando(true);
    try {
      const r = await api<{ campaign: { id: number }; total: number }>('POST', `/campaigns/${c.id}/duplicate`, { publico, ...(trocar && podeTexto ? { text: texto, textVariants: [] } : {}) });
      ok(`Nova campanha criada com ${fmtNum(r.total)} contato(s). Confira e clique em Iniciar.`);
      onCriada(r.campaign.id);
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };
  return (
    <Modal title="Reenviar ou duplicar" subtitle="Cria uma campanha nova (como rascunho) a partir desta. Quem pediu pra sair fica de fora." onClose={onClose} width={540}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={salvando} onClick={criar}><Copy size={15} /> Criar campanha</button></>}>
      <div style={{ display: 'grid', gap: 8 }}>
        {opcoes.map(([v, titulo, texto, n]) => (
          <button key={v} type="button" onClick={() => setPublico(v)} disabled={!n}
            style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px 14px', borderRadius: 8, border: `2px solid ${publico === v ? 'var(--verde)' : 'var(--line)'}`, background: publico === v ? 'var(--verde-soft)' : 'var(--card)', opacity: n ? 1 : 0.5 }}>
            <span style={{ flex: 1 }}><b style={{ display: 'block', fontSize: 14.5 }}>{titulo}</b><span style={{ fontSize: 13, color: 'var(--muted)' }}>{texto}</span></span>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--verde-escuro)' }}>{fmtNum(n)}</span>
          </button>
        ))}
      </div>
      {podeTexto && (
        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><input type="checkbox" checked={trocar} onChange={e => setTrocar(e.target.checked)} /> Mudar a mensagem (recomendado pra não repetir o mesmo texto)</label>
          {trocar && <textarea style={{ ...inputStyle, minHeight: 110, marginTop: 8, resize: 'vertical' }} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ex.: Oi {primeiro_nome}, conseguiu ver nossa mensagem?" />}
        </div>
      )}
    </Modal>
  );
}
