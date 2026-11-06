import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { api, erro, fmtTel } from '../lib/api';
import { abrirAudio, type ConexaoAudio } from '../lib/ligacaoAudio';
import { notificar, tocarChamada } from '../lib/som';

type Chamada = { callId: string; direcao: 'saida' | 'entrada'; telefone: string; nome: string; conversationId: number | null; connName: string; status: 'chamando' | 'tocando' | 'em_andamento' | 'encerrada'; userId: number | null; userNome: string; inicio: number; atendidaEm: number | null };

/** Pra qualquer tela pedir uma ligação: window.dispatchEvent(new CustomEvent('inoova:ligar', { detail: { conversationId } })) */
export const pedirLigacao = (conversationId: number) => window.dispatchEvent(new CustomEvent('inoova:ligar', { detail: { conversationId } }));

const relogio = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` };

export function Telefone() {
  const nav = useNavigate();
  const [ativas, setAtivas] = useState<Chamada[]>([]);
  const [minha, setMinha] = useState<Chamada | null>(null);
  const [mudo, setMudo] = useState(false);
  const [, setTique] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const conexao = useRef<ConexaoAudio | null>(null);
  const pararToque = useRef<(() => void) | null>(null);
  const avisadas = useRef(new Set<string>());

  const encerrarAudio = () => { conexao.current?.fechar(); conexao.current = null; setMudo(false) };

  // acompanha as ligações da empresa a cada 2 s
  useEffect(() => {
    let vivo = true;
    const ver = () => api<{ calls: Chamada[] }>('GET', '/calls/active').then(r => { if (vivo) setAtivas(r.calls) }).catch(() => {});
    ver();
    const t = setInterval(ver, 2000);
    const r = setInterval(() => setTique(x => x + 1), 1000);
    return () => { vivo = false; clearInterval(t); clearInterval(r) };
  }, []);

  // minha ligação: atualiza status; quando atende, confere o som; quando acaba, fecha o áudio
  useEffect(() => {
    if (!minha) return;
    const atual = ativas.find(c => c.callId === minha.callId);
    if (!atual) { if (minha.status !== 'encerrada') { setMinha({ ...minha, status: 'encerrada' }); encerrarAudio() } return }
    if (atual.status !== minha.status) {
      if (atual.status === 'em_andamento') conexao.current?.atendida();
      if (atual.status === 'encerrada') encerrarAudio();
      setMinha(atual);
    }
  }, [ativas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (minha?.status === 'encerrada') { const t = setTimeout(() => setMinha(null), 3500); return () => clearTimeout(t) } }, [minha?.status]);

  // ligação chegando (ninguém atendeu ainda): toca e avisa
  const chegando = !minha ? ativas.find(c => c.direcao === 'entrada' && c.status === 'tocando') : undefined;
  useEffect(() => {
    if (chegando) {
      if (!pararToque.current) pararToque.current = tocarChamada();
      if (!avisadas.current.has(chegando.callId)) {
        avisadas.current.add(chegando.callId);
        notificar('📞 Ligação no WhatsApp', `${chegando.nome || fmtTel(chegando.telefone)} está ligando (${chegando.connName})`);
      }
    } else { pararToque.current?.(); pararToque.current = null }
  }, [chegando?.callId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { pararToque.current?.(); encerrarAudio() }, []);

  const conectarAudio = async (c: Chamada) => {
    try { conexao.current = await abrirAudio(c.callId, audioRef.current!); if (c.status === 'em_andamento') conexao.current.atendida() }
    catch (e) { erro(e); await api('POST', `/calls/${encodeURIComponent(c.callId)}/hangup`).catch(() => {}); setMinha(null) }
  };

  const ligar = useCallback(async (conversationId: number) => {
    if (minha && minha.status !== 'encerrada') return erro('Você já está numa ligação.');
    setOcupado(true);
    try {
      const r = await api<{ call: Chamada }>('POST', '/calls/dial', { conversationId });
      setMinha(r.call);
      await conectarAudio(r.call);
    } catch (e) { erro(e) } finally { setOcupado(false) }
  }, [minha]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ouvir = (e: Event) => void ligar((e as CustomEvent<{ conversationId: number }>).detail.conversationId);
    window.addEventListener('inoova:ligar', ouvir);
    return () => window.removeEventListener('inoova:ligar', ouvir);
  }, [ligar]);

  const atender = async (c: Chamada) => {
    pararToque.current?.(); pararToque.current = null;
    setOcupado(true);
    try {
      const r = await api<{ call: Chamada }>('POST', `/calls/${encodeURIComponent(c.callId)}/accept`);
      setMinha(r.call);
      await conectarAudio(r.call);
      if (r.call.conversationId) nav(`/conversas?c=${r.call.conversationId}`);
    } catch (e) { erro(e) } finally { setOcupado(false) }
  };
  const recusar = (c: Chamada) => { pararToque.current?.(); pararToque.current = null; void api('POST', `/calls/${encodeURIComponent(c.callId)}/reject`).catch(() => {}) };
  const desligar = () => { if (!minha) return; void api('POST', `/calls/${encodeURIComponent(minha.callId)}/hangup`).catch(() => {}); encerrarAudio(); setMinha({ ...minha, status: 'encerrada' }) };
  const alternarMudo = () => { const v = !mudo; setMudo(v); conexao.current?.mudo(v) };

  const cartao = { position: 'fixed' as const, right: 20, bottom: 20, zIndex: 90, width: 320, maxWidth: 'calc(100vw - 24px)', background: '#111B21', color: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 18px 40px rgba(0,0,0,.35)', animation: 'fadeUp .18s ease' };
  const redondo = (bg: string) => ({ width: 48, height: 48, borderRadius: 99, border: 'none', background: bg, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      {chegando && (
        <div style={cartao} role="alertdialog" aria-label="Ligação chegando">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 46, height: 46, borderRadius: 99, background: 'rgba(37,211,102,.18)', color: '#25D366', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.2s infinite' }}><PhoneIncoming size={22} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#8FA3A0' }}>Ligação no WhatsApp · {chegando.connName}</div>
              <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chegando.nome || fmtTel(chegando.telefone)}</div>
              {chegando.nome && <div style={{ fontSize: 12.5, color: '#8FA3A0' }}>{fmtTel(chegando.telefone)}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={() => recusar(chegando)} style={{ flex: 1, height: 42, borderRadius: 10, border: 'none', background: '#E5484D', color: '#fff', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><PhoneOff size={17} /> Recusar</button>
            <button onClick={() => atender(chegando)} disabled={ocupado} style={{ flex: 1, height: 42, borderRadius: 10, border: 'none', background: '#25D366', color: '#073B33', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Phone size={17} /> Atender</button>
          </div>
        </div>
      )}
      {minha && (
        <div style={cartao} role="dialog" aria-label="Ligação em andamento">
          <div style={{ fontSize: 12, color: '#8FA3A0' }}>{minha.direcao === 'saida' ? 'Ligando' : 'Ligação recebida'} · {minha.connName}</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{minha.nome || fmtTel(minha.telefone)}</div>
          <div style={{ fontSize: 14, marginTop: 6, color: minha.status === 'em_andamento' ? '#25D366' : '#C9D6D3', fontVariantNumeric: 'tabular-nums' }}>
            {minha.status === 'em_andamento' ? `● Em ligação · ${relogio(Date.now() - (minha.atendidaEm || Date.now()))}` : minha.status === 'encerrada' ? 'Ligação encerrada' : minha.status === 'tocando' ? 'Tocando no celular da pessoa…' : 'Chamando…'}
          </div>
          {minha.status !== 'encerrada' && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 16 }}>
              <button onClick={alternarMudo} title={mudo ? 'Ligar o microfone' : 'Mudo'} style={redondo(mudo ? '#F5A524' : 'rgba(255,255,255,.12)')}>{mudo ? <MicOff size={20} /> : <Mic size={20} />}</button>
              <button onClick={desligar} title="Desligar" style={redondo('#E5484D')}><PhoneOff size={20} /></button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
