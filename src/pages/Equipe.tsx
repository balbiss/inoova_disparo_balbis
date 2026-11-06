import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, confirmar, erro, fmtData, getUsuario, ok } from '../lib/api';
import { Cabecalho, Campo, Carregando, Modal, Pilula, btn, inputStyle } from '../components/ui';

type Membro = { id: number; name: string; email: string; role: 'admin' | 'user'; active: boolean; createdAt: string };

export default function Equipe() {
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [editar, setEditar] = useState<Membro | 'novo' | null>(null);
  const eu = getUsuario();
  const carregar = useCallback(() => api<{ users: Membro[] }>('GET', '/users').then(r => setLista(r.users)).catch(erro), []);
  useEffect(() => { carregar() }, [carregar]);

  if (eu?.role !== 'admin') return <p>Só o administrador da empresa gerencia a equipe.</p>;
  if (!lista) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Equipe" contagem={lista.length}>
        <button style={btn()} onClick={() => setEditar('novo')}><Plus size={16} /> Novo usuário</button>
      </Cabecalho>
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }} className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Acesso</th><th>Situação</th><th className="esconde-mobile">Desde</th></tr></thead>
          <tbody>
            {lista.map(m => (
              <tr key={m.id} className="linha-click" onClick={() => setEditar(m)}>
                <td style={{ fontWeight: 700, color: '#1D5FC2' }}>{m.name}{m.id === eu.id && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (você)</span>}</td>
                <td>{m.email}</td>
                <td>{m.role === 'admin' ? <Pilula cor="azul">Administrador</Pilula> : <Pilula>Usuário</Pilula>}</td>
                <td>{m.active ? <Pilula cor="verde">Ativo</Pilula> : <Pilula cor="vermelho">Desativado</Pilula>}</td>
                <td className="esconde-mobile" style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtData(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>Administrador gerencia a equipe. Usuário usa campanhas, contatos e conexões.</p>
      {editar && <EditarMembro m={editar === 'novo' ? null : editar} souEu={editar !== 'novo' && editar.id === eu.id} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); carregar() }} />}
    </>
  );
}

function EditarMembro({ m, souEu, onClose, onSalvo }: { m: Membro | null; souEu: boolean; onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(m?.name || '');
  const [email, setEmail] = useState(m?.email || '');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>(m?.role || 'user');
  const [ativo, setAtivo] = useState(m?.active ?? true);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      if (m) await api('PATCH', `/users/${m.id}`, { name: nome, role, active: ativo, ...(senha ? { password: senha } : {}) });
      else await api('POST', '/users', { name: nome, email, password: senha, role });
      ok(m ? 'Usuário salvo.' : 'Usuário criado.'); onSalvo();
    } catch (e) { erro(e) } finally { setSalvando(false) }
  };
  const excluir = async () => {
    if (!m || !(await confirmar(`Excluir ${m.name}?`, 'A pessoa perde o acesso. As campanhas criadas por ela continuam.', 'Excluir', true))) return;
    try { await api('DELETE', `/users/${m.id}`); ok('Usuário excluído.'); onSalvo() } catch (e) { erro(e) }
  };

  return (
    <Modal title={m ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}
      footer={<>
        {m && !souEu && <button style={btn('link', { color: 'var(--perigo)', marginRight: 'auto' })} onClick={excluir}>Excluir</button>}
        <button style={btn('ghost')} onClick={onClose}>Cancelar</button>
        <button style={btn()} disabled={salvando || nome.trim().length < 2 || (!m && (!email || senha.length < 6))} onClick={salvar}>Salvar</button>
      </>}>
      <Campo label="Nome"><input autoFocus style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} /></Campo>
      <Campo label="E-mail (login)"><input style={inputStyle} type="email" value={email} disabled={!!m} onChange={e => setEmail(e.target.value)} /></Campo>
      <Campo label={m ? 'Nova senha (deixe vazio pra manter)' : 'Senha'} ajuda="Pelo menos 6 caracteres."><input style={inputStyle} type="password" autoComplete="new-password" value={senha} onChange={e => setSenha(e.target.value)} /></Campo>
      <Campo label="Acesso">
        <select style={inputStyle} value={role} disabled={souEu} onChange={e => setRole(e.target.value as 'admin' | 'user')}>
          <option value="user">Usuário</option>
          <option value="admin">Administrador</option>
        </select>
      </Campo>
      {m && !souEu && <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} /> Ativo (pode entrar no sistema)</label>}
    </Modal>
  );
}
