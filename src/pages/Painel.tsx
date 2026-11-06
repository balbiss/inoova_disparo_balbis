import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Megaphone, MessageCircle, PhoneCall, Smartphone, UsersRound, AlertTriangle } from 'lucide-react';
import { api, erro, fmtData, fmtNum, getUsuario } from '../lib/api';
import { Cabecalho, Card, Carregando, btn } from '../components/ui';
import { StatusCampanha } from '../lib/status';

type Dados = {
  contatos: number;
  conexoes: { total: number; conectadas: number };
  hoje: { enviadas: number; atendidas: number; falhas: number };
  respostasHoje: number; naoLidas: number;
  ativas: { id: number; name: string; kind: string; status: string; pauseReason: string | null; waitReason: string | null; scheduledAt: string | null }[];
  dias: { dia: string; enviadas: number; ligacoes: number; falhas: number }[];
};

function Kpi({ icone, valor, label, cor = 'var(--verde-escuro)', fundo = 'var(--verde-soft)', to }: { icone: ReactNode; valor: ReactNode; label: string; cor?: string; fundo?: string; to?: string }) {
  const corpo = (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4, padding: 16, display: 'flex', alignItems: 'center', gap: 14, height: '100%' }}>
      <span style={{ width: 44, height: 44, borderRadius: 8, background: fundo, color: cor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icone}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{valor}</span>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{label}</span>
      </span>
    </div>
  );
  return to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{corpo}</Link> : corpo;
}

export default function Painel() {
  const [d, setD] = useState<Dados | null>(null);
  const u = getUsuario();

  useEffect(() => {
    const carregar = () => api<Dados>('GET', '/dashboard').then(setD).catch(erro);
    carregar();
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, []);

  if (!d) return <Carregando />;
  const max = Math.max(1, ...d.dias.map(x => x.enviadas + x.ligacoes + x.falhas));
  const semNumero = d.conexoes.total === 0;
  const desconectado = d.conexoes.total > 0 && d.conexoes.conectadas < d.conexoes.total;

  return (
    <>
      <Cabecalho titulo="Painel" contagem={u?.empresa?.name}>
        <Link to="/campanhas/nova" style={btn()}><Megaphone size={16} /> Nova campanha</Link>
      </Cabecalho>

      {(semNumero || desconectado) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--alerta-soft)', border: '1px solid #F7D9A4', borderRadius: 4, marginBottom: 16, fontSize: 14 }}>
          <AlertTriangle size={18} color="#9A6100" style={{ flex: 'none' }} />
          <span style={{ flex: 1 }}>{semNumero ? 'Você ainda não conectou nenhum número de WhatsApp. Conecte um pra começar a disparar.' : `${d.conexoes.total - d.conexoes.conectadas} número(s) de WhatsApp desconectado(s). Campanhas desses números ficam paradas.`}</span>
          <Link to="/conexoes" style={btn('ghost', { minHeight: 32 })}>Ir pra Conexões</Link>
        </div>
      )}

      <div className="grid-kpi" style={{ marginBottom: 16 }}>
        <Kpi icone={<UsersRound size={22} />} valor={fmtNum(d.contatos)} label="Contatos" to="/contatos" />
        <Kpi icone={<Smartphone size={22} />} valor={`${d.conexoes.conectadas}/${d.conexoes.total}`} label="Números conectados" to="/conexoes"
          cor={desconectado ? '#9A6100' : undefined} fundo={desconectado ? 'var(--alerta-soft)' : undefined} />
        <Kpi icone={<CheckCheck size={22} />} valor={fmtNum(d.hoje.enviadas)} label="Mensagens enviadas hoje" />
        <Kpi icone={<PhoneCall size={22} />} valor={fmtNum(d.hoje.atendidas)} label="Ligações atendidas hoje" cor="#1D5FC2" fundo="var(--info-soft)" />
        <Kpi icone={<MessageCircle size={22} />} valor={fmtNum(d.respostasHoje)} label={d.naoLidas ? `Responderam hoje · ${d.naoLidas} não lida(s)` : 'Responderam hoje'} cor="#7C5CFF" fundo="#F1EDFF" to="/conversas" />
      </div>

      <div className="grid-2">
        <Card title="Últimos 7 dias">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 170, paddingTop: 10 }}>
            {d.dias.map(x => {
              const total = x.enviadas + x.ligacoes + x.falhas;
              const dia = new Date(x.dia + 'T12:00:00');
              return (
                <div key={x.dia} title={`${x.enviadas} mensagens · ${x.ligacoes} ligações · ${x.falhas} falhas`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{total || ''}</span>
                  <div style={{ flex: 1, width: '100%', maxWidth: 34, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: `${(x.falhas / max) * 100}%`, background: '#F3A6A8', borderRadius: '3px 3px 0 0' }} />
                    <div style={{ height: `${(x.ligacoes / max) * 100}%`, background: '#7FB1F5' }} />
                    <div style={{ height: `${(x.enviadas / max) * 100}%`, background: 'var(--verde)', minHeight: total ? 0 : 2, borderRadius: x.falhas || x.ligacoes ? 0 : '3px 3px 0 0' }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{dia.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--verde)', borderRadius: 2, marginRight: 5 }} />Mensagens</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#7FB1F5', borderRadius: 2, marginRight: 5 }} />Ligações</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#F3A6A8', borderRadius: 2, marginRight: 5 }} />Falhas</span>
          </div>
        </Card>

        <Card title="Campanhas em andamento" right={<Link to="/campanhas" style={{ fontSize: 13 }}>Ver todas</Link>}>
          {d.ativas.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '10px 0' }}>Nenhuma campanha enviando agora.</p>
          ) : d.ativas.map(c => (
            <Link key={c.id} to={`/campanhas/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dashed var(--line)', color: 'inherit', textDecoration: 'none' }}>
              {c.kind === 'call' ? <PhoneCall size={17} color="var(--muted)" /> : <Megaphone size={17} color="var(--muted)" />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: '#1D5FC2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                {(c.status === 'paused' ? c.pauseReason : c.status === 'running' ? c.waitReason : c.scheduledAt ? 'Começa ' + fmtData(c.scheduledAt) : null) && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{c.status === 'paused' ? c.pauseReason : c.status === 'running' ? c.waitReason : 'Começa ' + fmtData(c.scheduledAt)}</span>}
              </span>
              <StatusCampanha status={c.status} esperando={!!c.waitReason} />
            </Link>
          ))}
        </Card>
      </div>
    </>
  );
}
