import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Download, Search, UserPlus, UsersRound } from 'lucide-react';
import { api, erro, fmtNum, fmtTel, ok } from '../lib/api';
import { Cabecalho, Carregando, Vazio, btn, inputStyle } from '../components/ui';

type Conexao = { id: number; name: string; connected: boolean };
type Grupo = { jid: string; name: string; participants: number; withPhone: number; announce: boolean };
type Participante = { name: string; phone: string; admin: boolean; eu: boolean };
type Categoria = { id: number; name: string };

const csv = (linhas: string[][]) => '﻿' + linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
function baixarArquivo(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const arquivoDe = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'grupo';

/** Extrair contatos de grupos do WhatsApp: ver os grupos do número, os participantes, salvar nos contatos ou baixar planilha. */
export default function Grupos() {
  const [conns, setConns] = useState<Conexao[] | null>(null);
  const [connId, setConnId] = useState<number | ''>('');
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [aberto, setAberto] = useState<Grupo | null>(null);
  const [participantes, setParticipantes] = useState<Participante[] | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [destino, setDestino] = useState('nenhuma'); // nenhuma | porgrupo | <id da categoria>
  const [trabalhando, setTrabalhando] = useState(false);

  useEffect(() => {
    api<{ connections: Conexao[] }>('GET', '/connections').then(r => {
      setConns(r.connections);
      const c = r.connections.find(x => x.connected) || r.connections[0];
      if (c) setConnId(c.id);
    }).catch(erro);
    api<{ categories: Categoria[] }>('GET', '/contacts/categories').then(r => setCats(r.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!connId) return;
    setCarregando(true); setGrupos(null); setMarcados([]); setAberto(null); setParticipantes(null);
    api<{ groups: Grupo[] }>('GET', `/connections/${connId}/groups`).then(r => setGrupos(r.groups)).catch(e => { erro(e); setGrupos([]) }).finally(() => setCarregando(false));
  }, [connId]);

  useEffect(() => {
    if (!aberto || !connId) return;
    setParticipantes(null);
    api<{ participants: Participante[] }>('GET', `/connections/${connId}/groups/${encodeURIComponent(aberto.jid)}/participants`).then(r => setParticipantes(r.participants)).catch(e => { erro(e); setParticipantes([]) });
  }, [aberto, connId]);

  const visiveis = useMemo(() => (grupos || []).filter(g => g.name.toLowerCase().includes(busca.trim().toLowerCase())), [grupos, busca]);
  const selecionados = (grupos || []).filter(g => marcados.includes(g.jid));
  const pessoas = selecionados.reduce((n, g) => n + g.withPhone, 0);
  const conexao = conns?.find(c => c.id === connId);

  const participantesDe = (g: Grupo) => api<{ participants: Participante[] }>('GET', `/connections/${connId}/groups/${encodeURIComponent(g.jid)}/participants`).then(r => r.participants);

  const baixar = async (lista: Grupo[]) => {
    setTrabalhando(true);
    try {
      const linhas: string[][] = [['Grupo', 'Nome', 'Telefone', 'Admin']];
      for (const g of lista) for (const p of await participantesDe(g)) if (p.phone && !p.eu) linhas.push([g.name, p.name, p.phone, p.admin ? 'sim' : '']);
      baixarArquivo(lista.length === 1 ? `contatos-${arquivoDe(lista[0].name)}.csv` : `contatos-${lista.length}-grupos.csv`, csv(linhas));
      ok(`Planilha com ${fmtNum(linhas.length - 1)} contato(s) baixada.`);
    } catch (e) { erro(e) } finally { setTrabalhando(false) }
  };

  const salvar = async () => {
    setTrabalhando(true);
    try {
      let criados = 0, existiam = 0, escondidos = 0;
      if (destino === 'porgrupo') {
        // uma categoria com o nome de cada grupo (depois dá pra disparar só pra ela)
        for (const g of selecionados) {
          const c = (await api<{ category: Categoria }>('POST', '/contacts/categories', { name: g.name.slice(0, 60) })).category;
          const r = await api<{ created: number; updated: number; hidden: number }>('POST', '/contacts/import-groups', { connectionId: connId, groupJids: [g.jid], categoryId: c.id });
          criados += r.created; existiam += r.updated; escondidos += r.hidden;
        }
      } else {
        const r = await api<{ created: number; updated: number; hidden: number }>('POST', '/contacts/import-groups', { connectionId: connId, groupJids: marcados, categoryId: destino === 'nenhuma' ? null : Number(destino) });
        criados = r.created; existiam = r.updated; escondidos = r.hidden;
      }
      ok(`${fmtNum(criados)} contato(s) novo(s) salvo(s)${existiam ? `, ${fmtNum(existiam)} já existia(m)` : ''}${escondidos ? `. ${fmtNum(escondidos)} escondem o número no grupo` : ''}.`);
      setMarcados([]);
      api<{ categories: Categoria[] }>('GET', '/contacts/categories').then(r => setCats(r.categories)).catch(() => {});
    } catch (e) { erro(e) } finally { setTrabalhando(false) }
  };

  if (!conns) return <Carregando />;
  if (!conns.length) return (
    <>
      <Cabecalho titulo="Grupos" />
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <Vazio icone={<UsersRound size={26} />} titulo="Conecte um número primeiro" texto="Os grupos aparecem aqui assim que você conectar o WhatsApp que participa deles." acao={<Link to="/conexoes" style={btn()}>Ir pra Conexões</Link>} />
      </div>
    </>
  );

  return (
    <>
      <Cabecalho titulo="Grupos" contagem={grupos ? `${grupos.length} grupo(s)` : undefined}>
        <select style={{ ...inputStyle, width: 240 }} value={connId} onChange={e => setConnId(Number(e.target.value) || '')} aria-label="Número">
          {conns.map(c => <option key={c.id} value={c.id}>{c.name}{c.connected ? '' : ' (desconectado)'}</option>)}
        </select>
      </Cabecalho>
      <p style={{ margin: '-8px 0 16px', fontSize: 14, color: 'var(--muted)' }}>Veja os grupos em que o número <b>{conexao?.name}</b> participa, marque os que quiser e salve os participantes nos seus contatos (pra mandar mensagem individual) ou baixe a planilha.</p>

      <div className="grid-grupos" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <Search size={15} color="var(--muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
              <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="Buscar grupo" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            {grupos && grupos.length > 0 && <button style={btn('link')} onClick={() => setMarcados(marcados.length === visiveis.length ? [] : visiveis.map(g => g.jid))}>{marcados.length === visiveis.length && visiveis.length ? 'Desmarcar todos' : 'Marcar todos'}</button>}
          </div>
          <div style={{ maxHeight: 'calc(100dvh - 330px)', minHeight: 240, overflowY: 'auto' }}>
            {carregando ? <Carregando texto="Buscando os grupos do número…" /> : !grupos?.length ? (
              <p style={{ padding: 24, color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>{conexao && !conexao.connected ? 'Esse número está desconectado.' : 'Esse número não está em nenhum grupo.'}</p>
            ) : visiveis.map(g => {
              const on = marcados.includes(g.jid);
              return (
                <div key={g.jid} onClick={() => setAberto(g)} className="linha-hover"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: aberto?.jid === g.jid ? '#F0F2F5' : on ? 'var(--verde-soft)' : undefined }}>
                  <input type="checkbox" checked={on} onClick={e => e.stopPropagation()} onChange={() => setMarcados(l => (on ? l.filter(x => x !== g.jid) : [...l, g.jid]))} aria-label={`Marcar ${g.name}`} style={{ width: 17, height: 17 }} />
                  <span style={{ width: 38, height: 38, borderRadius: 99, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><UsersRound size={18} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{g.participants} participante(s){g.withPhone < g.participants ? ` · ${g.withPhone} com número visível` : ''}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          {!aberto ? (
            <Vazio icone={<UsersRound size={24} />} titulo="Clique num grupo" texto="Pra ver quem participa dele antes de extrair." />
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aberto.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{participantes ? `${participantes.filter(p => p.phone && !p.eu).length} contato(s) pra extrair` : 'Carregando…'}</div>
                </div>
                <button style={btn('ghost', { minHeight: 32 })} disabled={trabalhando} onClick={() => baixar([aberto])}><Download size={14} /> Planilha</button>
              </div>
              <div style={{ maxHeight: 'calc(100dvh - 330px)', minHeight: 240, overflowY: 'auto' }}>
                {!participantes ? <Carregando /> : participantes.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--line)', opacity: p.phone ? 1 : 0.55 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || 'Sem nome'}{p.eu && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (este número)</span>}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{p.phone ? fmtTel(p.phone) : 'Número escondido no grupo'}</span>
                    </span>
                    {p.admin && <span title="Administrador do grupo" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: '#9A6100' }}><Crown size={13} /> Admin</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {marcados.length > 0 && (
        <div style={{ position: 'sticky', bottom: 12, marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', background: '#111B21', color: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.2)' }}>
          <span style={{ flex: '1 1 200px', fontSize: 14 }}><b>{marcados.length}</b> grupo(s) marcado(s) · cerca de <b>{fmtNum(pessoas)}</b> contato(s)</span>
          <select value={destino} onChange={e => setDestino(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 220, background: '#fff', color: '#111B21' }} aria-label="Categoria">
            <option value="nenhuma">Salvar sem categoria</option>
            <option value="porgrupo">Criar uma categoria com o nome de cada grupo</option>
            {cats.map(c => <option key={c.id} value={c.id}>Na categoria “{c.name}”</option>)}
          </select>
          <button style={btn('ghost', { background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.35)' })} disabled={trabalhando} onClick={() => baixar(selecionados)}><Download size={15} /> Baixar planilha</button>
          <button style={btn('primary', { background: '#25D366', color: '#073B33' })} disabled={trabalhando} onClick={salvar}><UserPlus size={15} /> {trabalhando ? 'Salvando…' : 'Salvar nos contatos'}</button>
        </div>
      )}
    </>
  );
}
