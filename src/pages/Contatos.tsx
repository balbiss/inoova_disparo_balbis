import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, Plus, Search, Tags, Trash2, UsersRound, Pencil, ShieldCheck, Square, UserPlus } from 'lucide-react';
import { api, confirmar, erro, fmtData, fmtNum, fmtTel, getUsuario, ok } from '../lib/api';
import { Cabecalho, Campo, Carregando, Modal, Paginacao, Pilula, Progresso, Vazio, btn, inputStyle } from '../components/ui';
import { lerCsv, lerLista, mapearColunas } from '../lib/planilha';

type Categoria = { id: number; name: string; color: string; total: number };
type Contato = { id: number; name: string; phone: string; categoryId: number | null; optOut: boolean; waStatus: 'unknown' | 'valid' | 'invalid'; createdAt: string };
type Validacao = { total: number; feitos: number; validos: number; invalidos: number; rodando: boolean; erro?: string };

const CORES = ['#128C7E', '#25D366', '#34B7F1', '#7C5CFF', '#F5A524', '#E5484D', '#EC4899', '#54656F'];

export function TagCategoria({ c }: { c?: Categoria | null }) {
  if (!c) return <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>;
  return <span style={{ display: 'inline-block', maxWidth: 170, padding: '1px 7px', borderRadius: 2, border: `1px solid ${c.color}`, color: c.color, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>{c.name}</span>;
}

export default function Contatos() {
  const [cats, setCats] = useState<Categoria[]>([]);
  const [dados, setDados] = useState<{ contacts: Contato[]; total: number } | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [situacao, setSituacao] = useState('');
  const [val, setVal] = useState<Validacao | null>(null);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editar, setEditar] = useState<Contato | 'novo' | null>(null);
  const [importar, setImportar] = useState(false);
  const [extrair, setExtrair] = useState(false);
  const [gerenciar, setGerenciar] = useState(false);
  const per = 50;
  const limite = getUsuario()?.empresa?.maxContacts;
  const busca = useRef<ReturnType<typeof setTimeout>>();

  const carregarCats = useCallback(() => api<{ categories: Categoria[] }>('GET', '/contacts/categories').then(r => setCats(r.categories)).catch(erro), []);
  const carregar = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), per: String(per) });
    if (q.trim()) p.set('q', q.trim());
    if (cat) p.set('category', cat);
    if (situacao) p.set('situacao', situacao);
    return api<{ contacts: Contato[]; total: number }>('GET', '/contacts?' + p).then(setDados).catch(erro);
  }, [page, q, cat, situacao]);

  useEffect(() => { carregarCats() }, [carregarCats]);
  // validação no WhatsApp em segundo plano: acompanha o progresso
  useEffect(() => {
    let vivo = true;
    const ver = () => api<{ progress: Validacao | null }>('GET', '/contacts/validate').then(r => {
      if (!vivo) return;
      setVal(v => {
        if (v?.rodando && r.progress && !r.progress.rodando) {
          carregar();
          if (r.progress.erro) erro(r.progress.erro); else ok(`Validação concluída: ${r.progress.validos} com WhatsApp, ${r.progress.invalidos} sem.`);
        }
        return r.progress;
      });
    }).catch(() => {});
    ver();
    const t = setInterval(ver, 3000);
    return () => { vivo = false; clearInterval(t) };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearTimeout(busca.current); busca.current = setTimeout(carregar, q ? 300 : 0); return () => clearTimeout(busca.current) }, [carregar, q]);
  useEffect(() => { setSel(new Set()) }, [page, q, cat, situacao]);

  const validar = async () => {
    if (!(await confirmar('Validar os números no WhatsApp?', 'Confere quem tem WhatsApp, devagar (cerca de 1 por segundo) pra não chamar atenção. Só os que ainda não foram validados. Precisa de um número conectado.', 'Validar'))) return;
    try { const r = await api<{ progress: Validacao }>('POST', '/contacts/validate', { q, category: cat, situacao }); setVal(r.progress); ok('Validação iniciada.') } catch (e) { erro(e) }
  };

  const recarregarTudo = () => { carregar(); carregarCats() };
  const catDe = (id: number | null) => cats.find(c => c.id === id);
  const todosSel = !!dados?.contacts.length && dados.contacts.every(c => sel.has(c.id));

  const excluirSel = async () => {
    if (!(await confirmar(`Excluir ${sel.size} contato(s)?`, 'Eles saem da sua lista. Campanhas antigas continuam no histórico.', 'Excluir', true))) return;
    try { const r = await api<{ deleted: number }>('POST', '/contacts/delete', { ids: [...sel] }); ok(`${r.deleted} contato(s) excluído(s).`); setSel(new Set()); recarregarTudo() } catch (e) { erro(e) }
  };
  const excluirFiltro = async () => {
    if (!dados) return;
    const desc = q || cat || situacao ? 'todos os contatos deste filtro' : 'TODOS os seus contatos';
    if (!(await confirmar(`Excluir ${fmtNum(dados.total)} contato(s)?`, `Isso apaga ${desc}. Não dá pra desfazer.`, 'Excluir tudo', true))) return;
    try { const r = await api<{ deleted: number }>('POST', '/contacts/delete', { all: true, q, category: cat, situacao }); ok(`${r.deleted} contato(s) excluído(s).`); setPage(1); recarregarTudo() } catch (e) { erro(e) }
  };

  return (
    <>
      <Cabecalho titulo="Contatos" contagem={dados ? `${fmtNum(dados.total)}${limite ? ' de ' + fmtNum(limite) : ''}` : undefined}>
        <button style={btn('ghost')} onClick={validar} disabled={!!val?.rodando || !dados?.total}><ShieldCheck size={16} /> Validar números</button>
        <button style={btn('ghost')} onClick={() => setGerenciar(true)}><Tags size={16} /> Categorias</button>
        <button style={btn('ghost')} onClick={() => setExtrair(true)}><UserPlus size={16} /> Extrair de grupos</button>
        <button style={btn('ghost')} onClick={() => setImportar(true)}><FileUp size={16} /> Importar</button>
        <button style={btn()} onClick={() => setEditar('novo')}><Plus size={16} /> Novo contato</button>
      </Cabecalho>

      {val?.rodando && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: 'var(--verde-soft)', border: '1px solid #BDE9D6', borderRadius: 4, marginBottom: 12, fontSize: 14, flexWrap: 'wrap' }}>
          <ShieldCheck size={18} color="var(--verde-escuro)" />
          <span>Validando no WhatsApp: <b>{val.feitos}</b> de {val.total} · {val.validos} com WhatsApp · {val.invalidos} sem</span>
          <div style={{ flex: '1 1 160px' }}><Progresso valor={val.feitos} total={val.total} /></div>
          <button style={btn('ghost', { minHeight: 30 })} onClick={() => api('POST', '/contacts/validate/stop').catch(erro)}><Square size={13} /> Parar</button>
        </div>
      )}
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }}>
        <div className="toolbar" style={{ display: 'flex', gap: 10, padding: 12, borderBottom: '1px solid var(--line)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 260px' }}>
            <Search size={16} color="var(--muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
            <input style={{ ...inputStyle, paddingLeft: 34 }} placeholder="Buscar por nome ou telefone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
          </div>
          <select style={{ ...inputStyle, width: 220 }} value={cat} onChange={e => { setCat(e.target.value); setPage(1) }}>
            <option value="">Todas as categorias</option>
            <option value="none">Sem categoria</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({c.total})</option>)}
          </select>
          <select style={{ ...inputStyle, width: 200 }} value={situacao} onChange={e => { setSituacao(e.target.value); setPage(1) }}>
            <option value="">Todas as situações</option>
            <option value="valid">Com WhatsApp</option>
            <option value="invalid">Sem WhatsApp</option>
            <option value="unknown">Não validados</option>
            <option value="optout">Descadastrados</option>
          </select>
          {sel.size > 0
            ? <button style={btn('danger')} onClick={excluirSel}><Trash2 size={15} /> Excluir {sel.size}</button>
            : dados && dados.total > 0 && <button style={btn('link', { color: 'var(--perigo)' })} onClick={excluirFiltro}>Excluir todos</button>}
        </div>

        {!dados ? <Carregando /> : dados.contacts.length === 0 ? (
          q || cat || situacao ? <Vazio icone={<Search size={24} />} titulo="Nenhum contato encontrado" texto="Tente outro nome, telefone ou categoria." />
            : <Vazio icone={<UsersRound size={26} />} titulo="Sua lista está vazia" texto="Importe uma planilha (CSV) ou cole uma lista de nomes e telefones pra começar."
              acao={<button style={btn()} onClick={() => setImportar(true)}><FileUp size={16} /> Importar contatos</button>} />
        ) : (
          <>
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr>
                  <th style={{ width: 36 }}><input type="checkbox" aria-label="Selecionar todos" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(dados.contacts.map(c => c.id)))} /></th>
                  <th>Nome</th><th>Telefone</th><th>WhatsApp</th><th>Categoria</th><th className="esconde-mobile">Cadastrado em</th><th style={{ width: 40 }} />
                </tr></thead>
                <tbody>
                  {dados.contacts.map(c => (
                    <tr key={c.id}>
                      <td><input type="checkbox" aria-label={`Selecionar ${c.name}`} checked={sel.has(c.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} /></td>
                      <td style={{ fontWeight: 700, color: '#1D5FC2' }}>{c.name || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Sem nome</span>}{c.optOut && <span style={{ marginLeft: 8 }}><Pilula cor="vermelho">Descadastrado</Pilula></span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTel(c.phone)}</td>
                      <td>{c.waStatus === 'valid' ? <Pilula cor="verde">Tem</Pilula> : c.waStatus === 'invalid' ? <Pilula cor="vermelho">Não tem</Pilula> : <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>}</td>
                      <td><TagCategoria c={catDe(c.categoryId)} /></td>
                      <td className="esconde-mobile" style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtData(c.createdAt)}</td>
                      <td><button title="Editar" onClick={() => setEditar(c)} style={{ border: 'none', background: 'none', color: 'var(--muted)', padding: 4, display: 'flex' }}><Pencil size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao page={page} per={per} total={dados.total} onPage={setPage} />
          </>
        )}
      </div>

      {editar && <EditarContato contato={editar === 'novo' ? null : editar} cats={cats} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); recarregarTudo() }} />}
      {importar && <Importar cats={cats} onClose={() => setImportar(false)} onFeito={() => { setImportar(false); setPage(1); recarregarTudo() }} />}
      {extrair && <ExtrairGrupos cats={cats} onClose={() => setExtrair(false)} onFeito={() => { setExtrair(false); setPage(1); recarregarTudo() }} />}
      {gerenciar && <Categorias cats={cats} onClose={() => setGerenciar(false)} onMudou={recarregarTudo} />}
    </>
  );
}

function EditarContato({ contato, cats, onClose, onSalvo }: { contato: Contato | null; cats: Categoria[]; onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(contato?.name || '');
  const [tel, setTel] = useState(contato ? fmtTel(contato.phone) : '');
  const [cat, setCat] = useState<string>(contato?.categoryId ? String(contato.categoryId) : '');
  const [optOut, setOptOut] = useState(!!contato?.optOut);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    const corpo = { name: nome, phone: tel, categoryId: cat ? Number(cat) : null, ...(contato ? { optOut } : {}) };
    try {
      if (contato) await api('PATCH', `/contacts/${contato.id}`, corpo); else await api('POST', '/contacts', corpo);
      ok(contato ? 'Contato salvo.' : 'Contato criado.'); onSalvo();
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };
  const excluir = async () => {
    if (!contato || !(await confirmar('Excluir este contato?', '', 'Excluir', true))) return;
    try { await api('POST', '/contacts/delete', { ids: [contato.id] }); ok('Contato excluído.'); onSalvo() } catch (e) { erro(e) }
  };
  return (
    <Modal title={contato ? 'Editar contato' : 'Novo contato'} onClose={onClose}
      footer={<>
        {contato && <button style={btn('link', { color: 'var(--perigo)', marginRight: 'auto' })} onClick={excluir}>Excluir</button>}
        <button style={btn('ghost')} onClick={onClose}>Cancelar</button>
        <button style={btn()} disabled={salvando || tel.replace(/\D/g, '').length < 10} onClick={salvar}>Salvar</button>
      </>}>
      <Campo label="Nome"><input autoFocus style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} maxLength={120} /></Campo>
      <Campo label="Telefone (WhatsApp)" ajuda="Com DDD. Números sem o 55 são tratados como do Brasil."><input style={inputStyle} value={tel} onChange={e => setTel(e.target.value)} placeholder="(91) 98888-7777" inputMode="tel" /></Campo>
      <Campo label="Categoria">
        <select style={inputStyle} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Sem categoria</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Campo>
      {contato && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><input type="checkbox" checked={optOut} onChange={e => setOptOut(e.target.checked)} /> Descadastrado (não recebe campanhas)</label>}
    </Modal>
  );
}

function Importar({ cats, onClose, onFeito }: { cats: Categoria[]; onClose: () => void; onFeito: () => void }) {
  const [modo, setModo] = useState<'arquivo' | 'colar'>('arquivo');
  const [linhas, setLinhas] = useState<string[][] | null>(null);
  const [nomeArq, setNomeArq] = useState('');
  const [map, setMap] = useState<ReturnType<typeof mapearColunas> | null>(null);
  const [colado, setColado] = useState('');
  const [cat, setCat] = useState('');
  const [enviando, setEnviando] = useState(false);

  const abrir = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return erro('Salve a planilha como CSV antes (no Excel: Arquivo › Salvar como › CSV).');
    const texto = await f.text();
    const l = lerCsv(texto);
    if (!l.length) return erro('A planilha está vazia.');
    setNomeArq(f.name); setLinhas(l); setMap(mapearColunas(l));
  };

  const rows = (() => {
    if (modo === 'colar') return lerLista(colado);
    if (!linhas || !map || map.tel < 0) return [];
    return linhas.slice(map.temCabecalho ? 1 : 0).map(l => ({ name: map.nome >= 0 ? l[map.nome] || '' : '', phone: l[map.tel] || '' }));
  })();

  const importar = async () => {
    setEnviando(true);
    try {
      const r = await api<{ created: number; updated: number; invalid: number; duplicatedInFile: number }>('POST', '/contacts/import', { rows, categoryId: cat ? Number(cat) : null });
      const partes = [`${fmtNum(r.created)} novo(s)`];
      if (r.updated) partes.push(`${fmtNum(r.updated)} já existia(m)`);
      if (r.invalid) partes.push(`${fmtNum(r.invalid)} telefone(s) inválido(s)`);
      if (r.duplicatedInFile) partes.push(`${fmtNum(r.duplicatedInFile)} repetido(s)`);
      ok('Importado: ' + partes.join(', '));
      onFeito();
    } catch (e) { erro(e) } finally { setEnviando(false) }
  };

  const aba = (m: typeof modo, label: string) => (
    <button onClick={() => setModo(m)} style={{ flex: 1, padding: '10px 0', border: 'none', borderBottom: `2px solid ${modo === m ? 'var(--verde)' : 'transparent'}`, background: 'none', fontWeight: 700, fontSize: 13, color: modo === m ? 'var(--verde-escuro)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</button>
  );

  return (
    <Modal title="Importar contatos" onClose={onClose} width={620}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={enviando || !rows.length} onClick={importar}>{enviando ? 'Importando…' : `Importar ${rows.length ? fmtNum(rows.length) : ''}`}</button></>}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 16 }}>{aba('arquivo', 'Planilha CSV')}{aba('colar', 'Colar lista')}</div>
      {modo === 'arquivo' ? (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 22, border: '2px dashed #C9D1D5', borderRadius: 6, cursor: 'pointer', background: 'var(--card-2)', textAlign: 'center' }}>
            <FileUp size={26} color="var(--verde-escuro)" />
            <strong style={{ fontSize: 14 }}>{nomeArq || 'Escolher arquivo .csv'}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>No Excel ou Google Planilhas: Arquivo › Salvar como / Fazer download › CSV</span>
            <input type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }} onChange={e => abrir(e.target.files?.[0])} />
          </label>
          {linhas && map && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Campo label="Coluna do telefone" style={{ flex: 1, minWidth: 180 }}>
                  <select style={inputStyle} value={map.tel} onChange={e => setMap({ ...map, tel: Number(e.target.value) })}>
                    <option value={-1}>Escolha…</option>
                    {map.cabecalho.map((c, i) => <option key={i} value={i}>{c || `Coluna ${i + 1}`}</option>)}
                  </select>
                </Campo>
                <Campo label="Coluna do nome" style={{ flex: 1, minWidth: 180 }}>
                  <select style={inputStyle} value={map.nome} onChange={e => setMap({ ...map, nome: Number(e.target.value) })}>
                    <option value={-1}>Sem nome</option>
                    {map.cabecalho.map((c, i) => <option key={i} value={i}>{c || `Coluna ${i + 1}`}</option>)}
                  </select>
                </Campo>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Prévia ({fmtNum(rows.length)} linha(s)):</div>
              <div className="tabela-wrap" style={{ border: '1px solid var(--line)', borderRadius: 4, maxHeight: 170, overflowY: 'auto' }}>
                <table className="tabela"><thead><tr><th>Nome</th><th>Telefone</th></tr></thead>
                  <tbody>{rows.slice(0, 6).map((r, i) => <tr key={i}><td>{r.name || '—'}</td><td>{r.phone}</td></tr>)}</tbody></table>
              </div>
            </div>
          )}
        </>
      ) : (
        <Campo label="Uma pessoa por linha" ajuda={<>Ex.: <code>Maria Silva; 91 98888-7777</code> ou só o telefone. {colado.trim() && <b>{fmtNum(rows.length)} linha(s).</b>}</>}>
          <textarea style={{ ...inputStyle, minHeight: 170, fontFamily: 'monospace', fontSize: 13 }} value={colado} onChange={e => setColado(e.target.value)} placeholder={'Maria Silva; 91 98888-7777\nJoão; 11 97777-6666\n21966665555'} />
        </Campo>
      )}
      <Campo label="Colocar na categoria" style={{ marginTop: 14, marginBottom: 0 }}>
        <select style={inputStyle} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Sem categoria</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Campo>
    </Modal>
  );
}

function Categorias({ cats, onClose, onMudou }: { cats: Categoria[]; onClose: () => void; onMudou: () => void }) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES[0]);
  const criar = async () => {
    try { await api('POST', '/contacts/categories', { name: nome, color: cor }); setNome(''); onMudou() } catch (e) { erro(e) }
  };
  const excluir = async (c: Categoria) => {
    if (!(await confirmar(`Excluir a categoria "${c.name}"?`, c.total ? `Os ${c.total} contato(s) dela continuam, só ficam sem categoria.` : '', 'Excluir', true))) return;
    try { await api('DELETE', `/contacts/categories/${c.id}`); onMudou() } catch (e) { erro(e) }
  };
  return (
    <Modal title="Categorias" subtitle="Use categorias pra separar públicos (ex.: Clientes, Leads, VIP) e disparar só pra eles." onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && criar()} placeholder="Nova categoria" maxLength={60} />
        <button style={btn()} disabled={!nome.trim()} onClick={criar}><Plus size={16} /></button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {CORES.map(c => <button key={c} title={c} onClick={() => setCor(c)} style={{ width: 24, height: 24, borderRadius: 99, background: c, border: cor === c ? '3px solid var(--ink)' : '2px solid #fff', boxShadow: '0 0 0 1px var(--line)' }} />)}
      </div>
      {cats.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>Nenhuma categoria ainda.</p> : cats.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px dashed var(--line)' }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: c.color }} />
          <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtNum(c.total)} contato(s)</span>
          <button title="Excluir categoria" onClick={() => excluir(c)} style={{ border: 'none', background: 'none', color: 'var(--perigo)', padding: 4, display: 'flex' }}><Trash2 size={15} /></button>
        </div>
      ))}
    </Modal>
  );
}

/** Extrair contatos de grupos do WhatsApp: os participantes viram contatos (pra mandar individual). */
function ExtrairGrupos({ cats, onClose, onFeito }: { cats: Categoria[]; onClose: () => void; onFeito: () => void }) {
  const [conns, setConns] = useState<{ id: number; name: string; connected: boolean }[] | null>(null);
  const [connId, setConnId] = useState<number | ''>('');
  const [grupos, setGrupos] = useState<{ jid: string; name: string; participants: number; withPhone: number }[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ connections: { id: number; name: string; connected: boolean }[] }>('GET', '/connections').then(r => {
      setConns(r.connections);
      const c = r.connections.find(x => x.connected);
      if (c) setConnId(c.id);
    }).catch(erro);
  }, []);
  useEffect(() => {
    if (!connId) return;
    setCarregando(true); setGrupos(null); setSel([]);
    api<{ groups: { jid: string; name: string; participants: number; withPhone: number }[] }>('GET', `/connections/${connId}/groups`)
      .then(r => setGrupos(r.groups)).catch(e => { erro(e); setGrupos([]) }).finally(() => setCarregando(false));
  }, [connId]);

  const total = (grupos || []).filter(g => sel.includes(g.jid)).reduce((n, g) => n + g.withPhone, 0);
  const extrair = async () => {
    setEnviando(true);
    try {
      const r = await api<{ created: number; updated: number; hidden: number }>('POST', '/contacts/import-groups', { connectionId: connId, groupJids: sel, categoryId: cat ? Number(cat) : null });
      ok(`${fmtNum(r.created)} contato(s) novo(s)${r.updated ? `, ${fmtNum(r.updated)} já existia(m)` : ''}${r.hidden ? `. ${fmtNum(r.hidden)} participante(s) esconde(m) o número no grupo` : ''}.`);
      onFeito();
    } catch (e) { erro(e) } finally { setEnviando(false) }
  };

  return (
    <Modal title="Extrair contatos de grupos" subtitle="Os participantes dos grupos que você escolher entram na sua lista de contatos, pra você mandar mensagem individual pra cada um." onClose={onClose} width={580}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={enviando || !sel.length} onClick={extrair}>{enviando ? 'Extraindo…' : `Extrair ${total ? '~' + fmtNum(total) + ' contato(s)' : ''}`}</button></>}>
      {!conns ? <Carregando /> : conns.length === 0 ? <p style={{ color: 'var(--muted)' }}>Conecte um número de WhatsApp primeiro (menu Conexões).</p> : (
        <>
          <Campo label="Grupos de qual número?">
            <select style={inputStyle} value={connId} onChange={e => setConnId(Number(e.target.value) || '')}>
              {conns.map(c => <option key={c.id} value={c.id} disabled={!c.connected}>{c.name}{c.connected ? '' : ' (desconectado)'}</option>)}
            </select>
          </Campo>
          {carregando ? <Carregando texto="Buscando os grupos…" /> : grupos && (grupos.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>Esse número não está em nenhum grupo.</p> : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <input style={{ ...inputStyle, flex: '1 1 200px' }} placeholder="Buscar grupo" value={busca} onChange={e => setBusca(e.target.value)} />
                <button type="button" style={btn('link')} onClick={() => setSel(sel.length === grupos.length ? [] : grupos.map(g => g.jid))}>{sel.length === grupos.length ? 'Desmarcar todos' : 'Marcar todos'}</button>
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {grupos.filter(g => g.name.toLowerCase().includes(busca.toLowerCase())).map(g => {
                  const on = sel.includes(g.jid);
                  return (
                    <label key={g.jid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--verde-soft)' : 'transparent' }}>
                      <input type="checkbox" checked={on} onChange={() => setSel(l => (on ? l.filter(x => x !== g.jid) : [...l, g.jid]))} />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: on ? 700 : 400 }}>{g.name}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--muted)' }} title={g.withPhone < g.participants ? 'Alguns participantes escondem o número no grupo' : undefined}>{g.withPhone} de {g.participants} com número</span>
                    </label>
                  );
                })}
              </div>
              <Campo label="Colocar na categoria (opcional)" style={{ marginTop: 14, marginBottom: 0 }}>
                <select style={inputStyle} value={cat} onChange={e => setCat(e.target.value)}>
                  <option value="">Sem categoria</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Campo>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.5 }}>Dica: crie uma categoria com o nome do grupo antes, pra depois disparar só pra essas pessoas. Participantes que escondem o número no grupo não podem ser extraídos (regra do WhatsApp).</p>
            </>
          ))}
        </>
      )}
    </Modal>
  );
}
