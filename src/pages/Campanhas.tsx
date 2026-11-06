import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Megaphone, MessageSquareText, PhoneCall, Plus } from 'lucide-react';
import { api, erro, fmtData, fmtNum } from '../lib/api';
import { Cabecalho, Carregando, Progresso, Vazio, btn } from '../components/ui';
import { StatusCampanha, TIPO_MSG, feitos, type Stats } from '../lib/status';

export type CampanhaLista = {
  id: number; name: string; kind: 'message' | 'call'; status: string; messageType: string; callVideo: boolean;
  connectionName: string | null; createdByName: string | null; createdAt: string; pauseReason: string | null; stats: Stats;
};

export default function Campanhas() {
  const [lista, setLista] = useState<CampanhaLista[] | null>(null);
  const [filtro, setFiltro] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    const carregar = () => api<{ campaigns: CampanhaLista[] }>('GET', '/campaigns').then(r => setLista(r.campaigns)).catch(erro);
    carregar();
    const t = setInterval(carregar, 8000);
    return () => clearInterval(t);
  }, []);

  if (!lista) return <Carregando />;
  const filtrada = filtro ? lista.filter(c => (filtro === 'ativas' ? ['running', 'paused'].includes(c.status) : c.status === filtro)) : lista;
  const chip = (v: string, label: string, n: number) => (
    <button onClick={() => setFiltro(v)} style={{ padding: '6px 12px', borderRadius: 99, border: `1px solid ${filtro === v ? 'var(--verde)' : 'var(--line)'}`, background: filtro === v ? 'var(--verde-soft)' : 'var(--card)', color: filtro === v ? 'var(--verde-escuro)' : 'var(--ink)', fontSize: 13, fontWeight: 700 }}>{label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{n}</span></button>
  );

  return (
    <>
      <Cabecalho titulo="Campanhas" contagem={fmtNum(lista.length)}>
        <Link to="/campanhas/nova" style={btn()}><Plus size={16} /> Nova campanha</Link>
      </Cabecalho>

      {lista.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <Vazio icone={<Megaphone size={26} />} titulo="Nenhuma campanha ainda" texto="Crie uma campanha de mensagem (texto, imagem, áudio, vídeo ou documento) ou de ligação com áudio gravado."
            acao={<Link to="/campanhas/nova" style={btn()}><Plus size={16} /> Criar a primeira</Link>} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {chip('', 'Todas', lista.length)}
            {chip('ativas', 'Em andamento', lista.filter(c => ['running', 'paused'].includes(c.status)).length)}
            {chip('draft', 'Rascunhos', lista.filter(c => c.status === 'draft').length)}
            {chip('done', 'Concluídas', lista.filter(c => c.status === 'done').length)}
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }} className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Campanha</th><th>Situação</th><th style={{ minWidth: 160 }}>Progresso</th><th className="esconde-mobile">Resultado</th><th className="esconde-mobile">Número</th><th className="esconde-mobile">Criada</th></tr></thead>
              <tbody>
                {filtrada.map(c => (
                  <tr key={c.id} className="linha-click" onClick={() => nav(`/campanhas/${c.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 32, height: 32, borderRadius: 6, background: c.kind === 'call' ? 'var(--info-soft)' : 'var(--verde-soft)', color: c.kind === 'call' ? '#1D5FC2' : 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                          {c.kind === 'call' ? <PhoneCall size={16} /> : <MessageSquareText size={16} />}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 700, color: '#1D5FC2' }}>{c.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{c.kind === 'call' ? `Ligação ${c.callVideo ? 'de vídeo' : 'de áudio'}` : `Mensagem · ${TIPO_MSG[c.messageType]}`}</span>
                        </span>
                      </div>
                    </td>
                    <td><StatusCampanha status={c.status} />{c.status === 'paused' && c.pauseReason && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, maxWidth: 220 }}>{c.pauseReason}</div>}</td>
                    <td><Progresso valor={feitos(c.stats)} total={c.stats.total} /><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{fmtNum(feitos(c.stats))} de {fmtNum(c.stats.total)}</div></td>
                    <td className="esconde-mobile" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                      {c.kind === 'call'
                        ? <><b style={{ color: 'var(--verde-escuro)' }}>{fmtNum(c.stats.completed)}</b> atenderam · {fmtNum(c.stats.noAnswer)} não</>
                        : <><b style={{ color: 'var(--verde-escuro)' }}>{fmtNum(c.stats.sent)}</b> enviadas</>}
                      {c.stats.failed > 0 && <> · <span style={{ color: 'var(--perigo)' }}>{fmtNum(c.stats.failed)} falhas</span></>}
                    </td>
                    <td className="esconde-mobile" style={{ fontSize: 13 }}>{c.connectionName || '—'}</td>
                    <td className="esconde-mobile" style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtData(c.createdAt)}<div style={{ fontSize: 12 }}>{c.createdByName}</div></td>
                  </tr>
                ))}
                {filtrada.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>Nenhuma campanha neste filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
