import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, QrCode, Smartphone, Trash2, Unplug, Pencil, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, Flame } from 'lucide-react';
import { api, confirmar, erro, fmtTel, getUsuario, ok } from '../lib/api';
import { Cabecalho, Campo, Carregando, Modal, Pilula, Progresso, Vazio, btn, inputStyle } from '../components/ui';
import { Avatar } from '../components/Avatar';

type Conexao = {
  id: number; name: string; phone: string | null; connected: boolean; state: string; createdAt: string; avatarUrl?: string | null;
  health?: { restriction: boolean; restrictionEndsAt: string | null; capping: string | null; cappingRemaining: number | null; cappingTotal: number | null; at: string | null };
  seguranca?: { pausedUntil: string | null; pauseReason: string | null; nextAt: string | null; hora: number; dia: number; limiteHora: number; limiteDia: number; diaAquecimento: number | null };
};
const hhmm = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Saude({ c, onMudou }: { c: Conexao; onMudou: () => void }) {
  const [atualizando, setAtualizando] = useState(false);
  const h = c.health, sg = c.seguranca;
  if (!h || !sg) return null;
  const atualizar = async () => { setAtualizando(true); try { await api('POST', `/connections/${c.id}/health`); onMudou() } catch (e) { erro(e) } finally { setAtualizando(false) } };
  const reiniciar = async () => {
    if (!(await confirmar('Recomeçar o aquecimento?', 'Use quando o chip for novo ou o número voltou de um bloqueio. O limite do dia volta pro valor do 1º dia e sobe aos poucos.', 'Recomeçar'))) return;
    try { await api('POST', `/connections/${c.id}/reset-warmup`); ok('Aquecimento recomeçado.'); onMudou() } catch (e) { erro(e) }
  };
  const alertas: { cor: string; texto: string }[] = [];
  if (h.restriction) alertas.push({ cor: '#C42B30', texto: `Restrição do WhatsApp${h.restrictionEndsAt ? ' até ' + hhmm(h.restrictionEndsAt) : ''}: mensagens pra quem não respondeu podem não chegar. Disparos parados.` });
  if (h.capping === 'CAPPED') alertas.push({ cor: '#C42B30', texto: 'Limite de conversas novas do WhatsApp esgotado neste ciclo. Disparos parados até renovar.' });
  else if (h.capping === 'FIRST_WARNING' || h.capping === 'SECOND_WARNING') alertas.push({ cor: '#9A6100', texto: `Perto do limite de conversas novas do WhatsApp${h.cappingRemaining != null && h.cappingRemaining >= 0 ? ` (restam ${h.cappingRemaining})` : ''}.` });
  if (sg.pausedUntil) alertas.push({ cor: '#9A6100', texto: sg.pauseReason || `Pausa de segurança até ${hhmm(sg.pausedUntil)}` });
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)', fontSize: 13 }}>
      {alertas.map((a, i) => <div key={i} style={{ display: 'flex', gap: 6, color: a.cor, marginBottom: 8, lineHeight: 1.45 }}><ShieldAlert size={15} style={{ flex: 'none', marginTop: 1 }} /> {a.texto}</div>)}
      {!alertas.length && <div style={{ display: 'flex', gap: 6, color: 'var(--verde-escuro)', marginBottom: 8 }}><ShieldCheck size={15} /> Sem restrição do WhatsApp</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: 4 }}><span>Envios hoje</span><b style={{ color: 'var(--ink)' }}>{sg.dia} de {sg.limiteDia}</b></div>
      <Progresso valor={sg.dia} total={sg.limiteDia} cor={sg.dia >= sg.limiteDia ? '#F5A524' : 'var(--verde)'} />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginTop: 6 }}><span>Última hora</span><span>{sg.hora} de {sg.limiteHora}</span></div>
      {h.capping && h.capping !== 'UNLIMITED' && h.cappingTotal != null && h.cappingTotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginTop: 4 }}><span>Conversas novas (WhatsApp)</span><span>{h.cappingRemaining} de {h.cappingTotal} restantes</span></div>}
      {sg.diaAquecimento && <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9A6100', marginTop: 6 }}><Flame size={14} /> Aquecendo: dia {sg.diaAquecimento} · <button style={btn('link', { minHeight: 0, padding: 0, fontSize: 12.5 })} onClick={reiniciar}>recomeçar</button></div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
        <span>{h.at ? 'Verificado ' + hhmm(h.at) : 'Ainda não verificado'}</span>
        {c.connected && <button style={btn('link', { minHeight: 0, padding: 0, fontSize: 12.5 })} disabled={atualizando} onClick={atualizar}><RefreshCw size={12} /> {atualizando ? 'Verificando…' : 'Verificar agora'}</button>}
      </div>
    </div>
  );
}

export default function Conexoes() {
  const [lista, setLista] = useState<Conexao[] | null>(null);
  const [nova, setNova] = useState(false);
  const [conectar, setConectar] = useState<Conexao | null>(null);
  const [renomear, setRenomear] = useState<Conexao | null>(null);
  const limite = getUsuario()?.empresa?.maxConnections ?? 1;

  const carregar = useCallback(() => api<{ connections: Conexao[] }>('GET', '/connections').then(r => setLista(r.connections)).catch(erro), []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t) }, [carregar]);

  const desconectar = async (c: Conexao) => {
    if (!(await confirmar(`Desconectar "${c.name}"?`, 'O número sai do aparelho conectado. Campanhas desse número param até você conectar de novo.', 'Desconectar', true))) return;
    try { await api('POST', `/connections/${c.id}/logout`); ok('Número desconectado.'); carregar() } catch (e) { erro(e) }
  };
  const remover = async (c: Conexao) => {
    if (!(await confirmar(`Remover "${c.name}"?`, 'O número é desconectado e sai da lista. As campanhas antigas continuam no histórico.', 'Remover', true))) return;
    try { await api('DELETE', `/connections/${c.id}`); ok('Número removido.'); carregar() } catch (e) { erro(e) }
  };

  if (!lista) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Conexões" contagem={`${lista.length} de ${limite} número(s)`}>
        <button style={btn()} disabled={lista.length >= limite} title={lista.length >= limite ? 'Limite do seu plano' : undefined} onClick={() => setNova(true)}><Plus size={16} /> Adicionar número</button>
      </Cabecalho>

      {lista.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <Vazio icone={<Smartphone size={26} />} titulo="Nenhum número conectado" texto="Adicione o número de WhatsApp que vai fazer os disparos. A conexão é feita lendo um QR Code com o celular, igual ao WhatsApp Web."
            acao={<button style={btn()} onClick={() => setNova(true)}><Plus size={16} /> Adicionar número</button>} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
          {lista.map(c => (
            <div key={c.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4, borderTop: `3px solid ${c.connected ? 'var(--verde-zap)' : '#C9D1D5'}`, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Avatar url={c.avatarUrl} nome={c.name} size={48} apagado={!c.connected} icone={<Smartphone size={21} />} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</strong>
                    <button onClick={() => setRenomear(c)} title="Renomear" style={{ border: 'none', background: 'none', color: 'var(--muted)', padding: 2, display: 'flex' }}><Pencil size={13} /></button>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2 }}>{c.phone ? fmtTel(c.phone) : 'Número ainda não conectado'}</div>
                </div>
                {c.connected ? <Pilula cor="verde">Conectado</Pilula> : <Pilula cor="cinza">Desconectado</Pilula>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {c.connected
                  ? <button style={btn('ghost', { flex: 1 })} onClick={() => desconectar(c)}><Unplug size={15} /> Desconectar</button>
                  : <button style={btn('primary', { flex: 1 })} onClick={() => setConectar(c)}><QrCode size={15} /> Conectar</button>}
                <button style={btn('ghost', { padding: '0 11px' })} title="Remover número" onClick={() => remover(c)}><Trash2 size={15} color="var(--perigo)" /></button>
              </div>
              <Saude c={c} onMudou={carregar} />
            </div>
          ))}
        </div>
      )}

      {nova && <NovaConexao onClose={() => setNova(false)} onCriada={c => { setNova(false); carregar(); setConectar(c) }} />}
      {renomear && <Renomear c={renomear} onClose={() => setRenomear(null)} onSalvo={() => { setRenomear(null); carregar() }} />}
      {conectar && <Conectar c={conectar} onClose={() => { setConectar(null); carregar() }} />}
    </>
  );
}

function NovaConexao({ onClose, onCriada }: { onClose: () => void; onCriada: (c: Conexao) => void }) {
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    setSalvando(true);
    try { const r = await api<{ connection: Conexao }>('POST', '/connections', { name: nome }); onCriada(r.connection) }
    catch (e) { erro(e) } finally { setSalvando(false) }
  };
  return (
    <Modal title="Adicionar número" subtitle="Dê um nome pra identificar o número (ex.: Comercial, Suporte). No próximo passo você conecta pelo QR Code." onClose={onClose}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={salvando || !nome.trim()} onClick={criar}>Continuar</button></>}>
      <Campo label="Nome do número"><input autoFocus style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && criar()} placeholder="Comercial" maxLength={60} /></Campo>
    </Modal>
  );
}

function Renomear({ c, onClose, onSalvo }: { c: Conexao; onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(c.name);
  const salvar = async () => { try { await api('PATCH', `/connections/${c.id}`, { name: nome }); onSalvo() } catch (e) { erro(e) } };
  return (
    <Modal title="Renomear número" onClose={onClose} footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={!nome.trim()} onClick={salvar}>Salvar</button></>}>
      <Campo label="Nome"><input autoFocus style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} maxLength={60} /></Campo>
    </Modal>
  );
}

function Conectar({ c, onClose }: { c: Conexao; onClose: () => void }) {
  const [modo, setModo] = useState<'qr' | 'codigo'>('qr');
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const ultimoQr = useRef('');

  useEffect(() => {
    if (modo === 'qr') api('POST', `/connections/${c.id}/qr`).catch(erro);
  }, [c.id, modo]);

  useEffect(() => {
    let vivo = true;
    const ver = async () => {
      try {
        const s = await api<{ connected: boolean; qr: string | null }>('GET', `/connections/${c.id}/status`);
        if (!vivo) return;
        if (s.connected) { setConectado(true); return }
        if (s.qr && s.qr !== ultimoQr.current) {
          ultimoQr.current = s.qr;
          setQrImg(await QRCode.toDataURL(s.qr, { width: 264, margin: 1, color: { dark: '#111B21', light: '#ffffff' } }));
        }
      } catch { /* tenta de novo */ }
    };
    ver();
    const t = setInterval(ver, 2000);
    return () => { vivo = false; clearInterval(t) };
  }, [c.id]);

  useEffect(() => { if (conectado) { ok(`"${c.name}" conectado!`); const t = setTimeout(onClose, 1200); return () => clearTimeout(t) } }, [conectado, c.name, onClose]);

  const pedirCodigo = async () => {
    setGerando(true);
    try { const r = await api<{ code: string }>('POST', `/connections/${c.id}/pair-code`, { phone: telefone }); setCodigo(r.code) }
    catch (e) { erro(e) } finally { setGerando(false) }
  };

  const aba = (m: typeof modo, label: string) => (
    <button onClick={() => setModo(m)} style={{ flex: 1, padding: '10px 0', border: 'none', borderBottom: `2px solid ${modo === m ? 'var(--verde)' : 'transparent'}`, background: 'none', fontWeight: 700, fontSize: 13, color: modo === m ? 'var(--verde-escuro)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</button>
  );

  return (
    <Modal title={`Conectar "${c.name}"`} onClose={onClose} width={520}>
      {conectado ? (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <div style={{ width: 64, height: 64, borderRadius: 99, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>✓</div>
          <p style={{ fontWeight: 700, fontSize: 17 }}>Número conectado!</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 18 }}>{aba('qr', 'QR Code')}{aba('codigo', 'Código pelo número')}</div>
          {modo === 'qr' ? (
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div style={{ width: 264, height: 264, border: '1px solid var(--line)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', flex: 'none' }}>
                {qrImg ? <img src={qrImg} alt="QR Code para conectar o WhatsApp" width={264} height={264} /> : <Carregando texto="Gerando QR…" />}
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', flex: '1 1 180px' }}>
                <li>Abra o <b>WhatsApp</b> no celular</li>
                <li>Toque em <b>⋮ Mais opções</b> ou <b>Configurações</b></li>
                <li>Toque em <b>Aparelhos conectados</b> › <b>Conectar aparelho</b></li>
                <li>Aponte a câmera pra este QR Code</li>
              </ol>
            </div>
          ) : (
            <div>
              {codigo ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 0 }}>Digite este código no celular:</p>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '.22em', fontFamily: 'monospace', padding: '14px 0', background: 'var(--verde-soft)', borderRadius: 6, color: 'var(--teal)' }}>{codigo.slice(0, 4)}-{codigo.slice(4)}</div>
                  <ol style={{ textAlign: 'left', fontSize: 14, lineHeight: 1.7, paddingLeft: 18 }}>
                    <li>No WhatsApp, vá em <b>Aparelhos conectados</b> › <b>Conectar aparelho</b></li>
                    <li>Toque em <b>Conectar com número de telefone</b></li>
                    <li>Digite o código acima</li>
                  </ol>
                  <button style={btn('link')} onClick={() => setCodigo(null)}>Gerar outro código</button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 0, lineHeight: 1.55 }}>Use quando não der pra ler o QR (ex.: o número está neste mesmo celular). Informe o número que vai ser conectado:</p>
                  <Campo label="Número do WhatsApp (com DDD)"><input style={inputStyle} value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(91) 98888-7777" inputMode="tel" /></Campo>
                  <button style={btn('primary', { width: '100%' })} disabled={gerando || telefone.replace(/\D/g, '').length < 10} onClick={pedirCodigo}><KeyRound size={15} /> {gerando ? 'Gerando…' : 'Gerar código'}</button>
                </>
              )}
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', margin: '18px 0 0' }}>Esta janela fecha sozinha quando o número conectar.</p>
        </>
      )}
    </Modal>
  );
}
