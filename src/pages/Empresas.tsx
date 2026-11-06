import { useCallback, useEffect, useState } from 'react';
import { Building2, KeyRound, Plus } from 'lucide-react';
import Swal from 'sweetalert2';
import { api, confirmar, erro, fmtData, fmtNum, getUsuario, ok } from '../lib/api';
import { Cabecalho, Campo, Carregando, Modal, Pilula, Vazio, btn, inputStyle } from '../components/ui';

type Empresa = {
  id: number; name: string; active: boolean; maxConnections: number; maxContacts: number; createdAt: string;
  users: number; connections: number; contacts: number; campaigns: number; adminEmail: string | null;
};

export default function Empresas() {
  const [lista, setLista] = useState<Empresa[] | null>(null);
  const [editar, setEditar] = useState<Empresa | 'nova' | null>(null);
  const carregar = useCallback(() => api<{ tenants: Empresa[] }>('GET', '/admin/tenants').then(r => setLista(r.tenants)).catch(erro), []);
  useEffect(() => { carregar() }, [carregar]);

  if (getUsuario()?.role !== 'superadmin') return <p>Área do administrador do sistema.</p>;
  if (!lista) return <Carregando />;

  const alternar = async (e: Empresa) => {
    if (e.active && !(await confirmar(`Desativar "${e.name}"?`, 'Ninguém da empresa consegue entrar e as campanhas em andamento pausam.', 'Desativar', true))) return;
    try { await api('PATCH', `/admin/tenants/${e.id}`, { active: !e.active }); ok(e.active ? 'Empresa desativada.' : 'Empresa reativada.'); carregar() } catch (err) { erro(err) }
  };
  const resetar = async (e: Empresa) => {
    const r = await Swal.fire({ title: 'Nova senha do administrador', text: e.adminEmail || '', input: 'text', inputPlaceholder: 'Pelo menos 6 caracteres', showCancelButton: true, confirmButtonText: 'Salvar', cancelButtonText: 'Cancelar', confirmButtonColor: '#00A884', inputValidator: v => (v.length < 6 ? 'Pelo menos 6 caracteres.' : null) });
    if (!r.isConfirmed) return;
    try { const x = await api<{ email: string }>('POST', `/admin/tenants/${e.id}/reset-password`, { password: r.value }); ok(`Senha de ${x.email} trocada.`) } catch (err) { erro(err) }
  };
  const excluir = async (e: Empresa) => {
    if (!(await confirmar(`Excluir "${e.name}" de vez?`, `Apaga a empresa com ${e.contacts} contato(s), ${e.campaigns} campanha(s) e ${e.users} usuário(s). Não dá pra desfazer.`, 'Excluir tudo', true))) return;
    try { await api('DELETE', `/admin/tenants/${e.id}`); ok('Empresa excluída.'); carregar() } catch (err) { erro(err) }
  };

  return (
    <>
      <Cabecalho titulo="Empresas" contagem={lista.length}>
        <button style={btn()} onClick={() => setEditar('nova')}><Plus size={16} /> Nova empresa</button>
      </Cabecalho>
      {lista.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <Vazio icone={<Building2 size={26} />} titulo="Nenhuma empresa cadastrada" texto="Cadastre a empresa do cliente e o administrador dela. Ele recebe o e-mail e a senha pra entrar."
            acao={<button style={btn()} onClick={() => setEditar('nova')}><Plus size={16} /> Cadastrar empresa</button>} />
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4 }} className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Empresa</th><th>Situação</th><th>Números</th><th>Contatos</th><th className="esconde-mobile">Campanhas</th><th className="esconde-mobile">Desde</th><th /></tr></thead>
            <tbody>
              {lista.map(e => (
                <tr key={e.id}>
                  <td><button onClick={() => setEditar(e)} style={{ border: 'none', background: 'none', padding: 0, fontWeight: 700, color: '#1D5FC2', fontSize: 14, textAlign: 'left' }}>{e.name}</button><div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.adminEmail || 'sem administrador'} · {e.users} usuário(s)</div></td>
                  <td>{e.active ? <Pilula cor="verde">Ativa</Pilula> : <Pilula cor="vermelho">Desativada</Pilula>}</td>
                  <td>{e.connections} / {e.maxConnections}</td>
                  <td>{fmtNum(e.contacts)} / {fmtNum(e.maxContacts)}</td>
                  <td className="esconde-mobile">{fmtNum(e.campaigns)}</td>
                  <td className="esconde-mobile" style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtData(e.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button style={btn('link')} title="Trocar a senha do administrador" onClick={() => resetar(e)}><KeyRound size={14} /> Senha</button>
                    <button style={btn('link', { color: e.active ? 'var(--perigo)' : 'var(--verde-escuro)' })} onClick={() => alternar(e)}>{e.active ? 'Desativar' : 'Reativar'}</button>
                    {!e.active && <button style={btn('link', { color: 'var(--perigo)' })} onClick={() => excluir(e)}>Excluir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <EditarEmpresa e={editar === 'nova' ? null : editar} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); carregar() }} />}
    </>
  );
}

function EditarEmpresa({ e, onClose, onSalvo }: { e: Empresa | null; onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(e?.name || '');
  const [maxConn, setMaxConn] = useState(e?.maxConnections ?? 1);
  const [maxCont, setMaxCont] = useState(e?.maxContacts ?? 5000);
  const [adminNome, setAdminNome] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminSenha, setAdminSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      if (e) await api('PATCH', `/admin/tenants/${e.id}`, { name: nome, maxConnections: maxConn, maxContacts: maxCont });
      else await api('POST', '/admin/tenants', { name: nome, maxConnections: maxConn, maxContacts: maxCont, adminName: adminNome, adminEmail, adminPassword: adminSenha });
      ok(e ? 'Empresa salva.' : 'Empresa criada. Passe o e-mail e a senha pro cliente.'); onSalvo();
    } catch (err) { erro(err) } finally { setSalvando(false) }
  };

  return (
    <Modal title={e ? 'Editar empresa' : 'Nova empresa'} onClose={onClose} width={520}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={salvando || nome.trim().length < 2 || (!e && (adminNome.trim().length < 2 || !adminEmail || adminSenha.length < 6))} onClick={salvar}>Salvar</button></>}>
      <Campo label="Nome da empresa"><input autoFocus style={inputStyle} value={nome} onChange={x => setNome(x.target.value)} /></Campo>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Campo label="Números de WhatsApp" style={{ flex: 1, minWidth: 150 }}><input type="number" min={1} max={50} style={inputStyle} value={maxConn} onChange={x => setMaxConn(Number(x.target.value))} /></Campo>
        <Campo label="Limite de contatos" style={{ flex: 1, minWidth: 150 }}><input type="number" min={10} step={500} style={inputStyle} value={maxCont} onChange={x => setMaxCont(Number(x.target.value))} /></Campo>
      </div>
      {!e && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', margin: '6px 0 12px', paddingTop: 12, borderTop: '1px solid var(--line)' }}>Administrador da empresa</div>
          <Campo label="Nome"><input style={inputStyle} value={adminNome} onChange={x => setAdminNome(x.target.value)} /></Campo>
          <Campo label="E-mail (login)"><input type="email" style={inputStyle} value={adminEmail} onChange={x => setAdminEmail(x.target.value)} /></Campo>
          <Campo label="Senha inicial" ajuda="O cliente pode trocar depois em “Trocar minha senha”."><input style={inputStyle} value={adminSenha} onChange={x => setAdminSenha(x.target.value)} /></Campo>
        </>
      )}
    </Modal>
  );
}
