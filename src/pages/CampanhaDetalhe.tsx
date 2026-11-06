import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Download, MessageSquareText, Pause, PhoneCall, Play, Trash2, AlertTriangle } from 'lucide-react';
import { api, baixar, confirmar, erro, fmtData, fmtNum, fmtTel, getToken, ok } from '../lib/api';
import { Cabecalho, Card, Carregando, Paginacao, Progresso, btn } from '../components/ui';
import { StatusAlvo, StatusCampanha, TIPO_MSG, feitos, type Stats } from '../lib/status';

type Campanha = {
  id: number; name: string; kind: 'message' | 'call'; status: string; messageType: string; text: string; mediaName: string | null; mediaMime: string | null; hasMedia: boolean;
  callVideo: boolean; maxRingSeconds: number; minDelay: number; maxDelay: number; pauseReason: string | null; nextAt: string | null;
  startedAt: string | null; finishedAt: string | null; createdAt: string; connectionName: string | null; stats: Stats;
};
type Alvo = { id: number; name: string; phone: string; status: string; error: string | null; durationMs: number | null; doneAt: string | null };

function Numero({ valor, label, cor }: { valor: number; label: string; cor?: string }) {
  return (
    <div style={{ flex: '1 1 120px', padding: '12px 14px', borderLeft: `3px solid ${cor || 'var(--line)'}`, background: 'var(--card-2)', borderRadius: 3 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor }}>{fmtNum(valor)}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

export default function CampanhaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Campanha | null>(null);
  const [alvos, setAlvos] = useState<{ targets: Alvo[]; total: number } | null>(null);
  const [filtro, setFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [midiaUrl, setMidiaUrl] = useState<string | null>(null);
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
    if (!c || !['running', 'paused'].includes(c.status)) return;
    const t = setInterval(carregar, c.status === 'running' ? 3000 : 10000);
    return () => clearInterval(t);
  }, [c?.status, carregar]); // eslint-disable-line react-hooks/exhaustive-deps

  // mídia autenticada pra pré-visualizar
  useEffect(() => {
    if (!c?.hasMedia) return;
    let url = '';
    fetch(`/api/campaigns/${c.id}/media`, { headers: { Authorization: 'Bearer ' + getToken() } }).then(r => r.ok ? r.blob() : null).then(b => { if (b) { url = URL.createObjectURL(b); setMidiaUrl(url) } });
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

  if (!c || !alvos) return <Carregando />;
  const s = c.stats;
  const proximo = c.status === 'running' && c.nextAt && new Date(c.nextAt).getTime() > Date.now() ? Math.ceil((new Date(c.nextAt).getTime() - Date.now()) / 1000) : null;

  const filtros: [string, string, number][] = c.kind === 'call'
    ? [['', 'Todos', s.total], ['pending', 'Na fila', s.pending], ['completed', 'Atenderam', s.completed], ['no-answer', 'Não atenderam', s.noAnswer], ['failed', 'Falharam', s.failed]]
    : [['', 'Todos', s.total], ['pending', 'Na fila', s.pending], ['sent', 'Enviadas', s.sent], ['failed', 'Falharam', s.failed]];

  let botoes: ReactNode = null;
  if (c.status === 'draft') botoes = <button style={btn()} onClick={() => acao('start', 'Campanha iniciada.')}><Play size={15} /> Iniciar</button>;
  if (c.status === 'running') botoes = <button style={btn('ghost')} onClick={() => acao('pause', 'Campanha pausada.')}><Pause size={15} /> Pausar</button>;
  if (c.status === 'paused') botoes = <button style={btn()} onClick={() => acao('start', 'Campanha retomada.')}><Play size={15} /> Retomar</button>;

  return (
    <>
      <Link to="/campanhas" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}><ArrowLeft size={15} /> Campanhas</Link>
      <Cabecalho titulo={c.name}>
        <StatusCampanha status={c.status} />
        {botoes}
        {['draft', 'running', 'paused'].includes(c.status) && <button style={btn('ghost')} onClick={() => acao('cancel', 'Campanha cancelada.', ['Cancelar a campanha?', 'Quem ainda está na fila não recebe. Não dá pra retomar depois.', 'Cancelar campanha', true])}><Ban size={15} /> Cancelar</button>}
        {feitos(s) > 0 && <button style={btn('ghost')} onClick={() => baixar(`/campaigns/${c.id}/export`, `campanha-${c.id}.csv`)}><Download size={15} /> Relatório</button>}
        {c.status !== 'running' && <button style={btn('ghost', { padding: '0 11px' })} title="Excluir campanha" onClick={excluir}><Trash2 size={15} color="var(--perigo)" /></button>}
      </Cabecalho>

      {c.status === 'paused' && c.pauseReason && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--alerta-soft)', border: '1px solid #F7D9A4', borderRadius: 4, marginBottom: 14, fontSize: 14 }}>
          <AlertTriangle size={18} color="#9A6100" /> {c.pauseReason}
        </div>
      )}

      <div className="grid-camp">
        <div style={{ minWidth: 0 }}>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}><Progresso valor={feitos(s)} total={s.total} /></div>
              <span style={{ fontSize: 14 }}><b>{fmtNum(feitos(s))}</b> de {fmtNum(s.total)} {c.kind === 'call' ? 'ligações' : 'contatos'}</span>
              {proximo !== null && <span style={{ fontSize: 13, color: 'var(--muted)' }}>próximo em ~{proximo}s</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Numero valor={s.pending} label="Na fila" />
              {c.kind === 'call' ? <>
                <Numero valor={s.completed} label="Atenderam" cor="var(--verde-escuro)" />
                <Numero valor={s.noAnswer} label="Não atenderam" cor="#54656F" />
              </> : <Numero valor={s.sent} label="Enviadas" cor="var(--verde-escuro)" />}
              <Numero valor={s.failed} label="Falharam" cor="var(--perigo)" />
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
                <thead><tr><th>Contato</th><th>Telefone</th><th>Situação</th>{c.kind === 'call' && <th>Duração</th>}<th className="esconde-mobile">Quando</th></tr></thead>
                <tbody>
                  {alvos.targets.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700 }}>{t.name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Sem nome</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTel(t.phone)}</td>
                      <td><StatusAlvo status={t.status} />{t.error && <div style={{ fontSize: 12, color: 'var(--perigo)', marginTop: 3, maxWidth: 300 }}>{t.error}</div>}</td>
                      {c.kind === 'call' && <td style={{ fontSize: 13 }}>{t.durationMs ? `${Math.round(t.durationMs / 1000)}s` : '—'}</td>}
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

        <Card title="Detalhes">
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <Linha k="Tipo" v={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.kind === 'call' ? <PhoneCall size={14} /> : <MessageSquareText size={14} />}{c.kind === 'call' ? `Ligação ${c.callVideo ? 'de vídeo' : 'de áudio'}` : `Mensagem · ${TIPO_MSG[c.messageType]}`}</span>} />
            <Linha k="Número" v={c.connectionName || '—'} />
            <Linha k="Intervalo" v={`${c.minDelay}s a ${c.maxDelay}s`} />
            {c.kind === 'call' && <Linha k="Toque máximo" v={`${c.maxRingSeconds}s`} />}
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
          {c.text && <div style={{ marginTop: 14, padding: 10, background: 'var(--balao)', borderRadius: 6, fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.text}</div>}
        </Card>
      </div>
    </>
  );
}

function Linha({ k, v }: { k: string; v: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px dashed var(--line)' }}><span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span></div>;
}
