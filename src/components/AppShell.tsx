import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Building2, ChevronDown, KeyRound, LayoutDashboard, LogOut, Megaphone, Menu, PanelLeft, Smartphone, Users, UsersRound, X } from 'lucide-react';
import { api, erro, getUsuario, ok, sair, salvarSessao, getToken, type Usuario } from '../lib/api';
import { Logo, LogoMarca } from './Logo';
import { Campo, Modal, btn, inputStyle } from './ui';

type Item = { to: string; label: string; icon: ReactNode };

function menuDe(u: Usuario | null): Item[] {
  if (!u) return [];
  if (u.role === 'superadmin') return [{ to: '/empresas', label: 'Empresas', icon: <Building2 size={20} /> }];
  const l: Item[] = [
    { to: '/painel', label: 'Painel', icon: <LayoutDashboard size={20} /> },
    { to: '/campanhas', label: 'Campanhas', icon: <Megaphone size={20} /> },
    { to: '/contatos', label: 'Contatos', icon: <UsersRound size={20} /> },
    { to: '/conexoes', label: 'Conexões', icon: <Smartphone size={20} /> },
  ];
  if (u.role === 'admin') l.push({ to: '/equipe', label: 'Equipe', icon: <Users size={20} /> });
  return l;
}

const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

function Navegacao({ itens, compacto, onClick }: { itens: Item[]; compacto: boolean; onClick?: () => void }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px' }}>
      {itens.map(i => (
        <NavLink key={i.to} to={i.to} onClick={onClick} title={compacto ? i.label : undefined}
          style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 12, padding: compacto ? '11px 0' : '10px 12px', justifyContent: compacto ? 'center' : 'flex-start',
            borderRadius: 6, color: isActive ? '#fff' : 'var(--side-ink)', background: isActive ? 'var(--side-active)' : 'transparent',
            fontSize: 14.5, fontWeight: isActive ? 700 : 400, textDecoration: 'none', position: 'relative',
            boxShadow: isActive ? 'inset 3px 0 0 #25D366' : undefined,
          })}>
          {i.icon}
          {!compacto && <span>{i.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const [usuario, setUsuario] = useState<Usuario | null>(getUsuario());
  const [aberto, setAberto] = useState(() => localStorage.getItem('menu_compacto') !== '1');
  const [mobile, setMobile] = useState(false);
  const [perfil, setPerfil] = useState(false);
  const [senha, setSenha] = useState(false);
  const loc = useLocation();
  const itens = menuDe(usuario);

  // atualiza o perfil ao abrir (limites da empresa / papel podem mudar)
  useEffect(() => {
    api<{ user: Usuario }>('GET', '/auth/me').then(r => { setUsuario(r.user); salvarSessao(getToken()!, r.user) }).catch(() => {});
  }, []);
  useEffect(() => { setMobile(false); setPerfil(false) }, [loc.pathname]);

  const alternar = () => setAberto(a => { localStorage.setItem('menu_compacto', a ? '1' : '0'); return !a });
  const largura = aberto ? 224 : 68;

  return (
    <div style={{ minHeight: '100%' }}>
      <aside className="app-sidebar" style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: largura, background: 'var(--side)', color: 'var(--side-ink)', display: 'flex', flexDirection: 'column', zIndex: 30, transition: 'width .15s' }}>
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: aberto ? 'flex-start' : 'center', padding: aberto ? '0 18px' : 0, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          {aberto ? <Logo size={30} fonte={17} /> : <LogoMarca size={30} />}
        </div>
        {usuario?.empresa && aberto && (
          <div style={{ padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--side-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario.empresa.name}</div>
        )}
        <Navegacao itens={itens} compacto={!aberto} />
        <div style={{ flex: 1 }} />
        <button onClick={alternar} title={aberto ? 'Recolher menu' : 'Abrir menu'}
          style={{ margin: 10, height: 36, border: 'none', borderRadius: 6, background: 'rgba(255,255,255,.08)', color: 'var(--side-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}>
          <PanelLeft size={17} /> {aberto && 'Recolher'}
        </button>
      </aside>

      {mobile && (
        <div onClick={() => setMobile(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(11,20,26,.45)', zIndex: 60 }}>
          <aside onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 260, background: 'var(--side)', animation: 'slideIn .18s ease', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 0 18px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
              <Logo size={28} fonte={16} />
              <button onClick={() => setMobile(false)} aria-label="Fechar menu" style={{ border: 'none', background: 'none', color: '#fff', padding: 6 }}><X size={20} /></button>
            </div>
            {usuario?.empresa && <div style={{ padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--side-muted)' }}>{usuario.empresa.name}</div>}
            <Navegacao itens={itens} compacto={false} onClick={() => setMobile(false)} />
          </aside>
        </div>
      )}

      <div className="content-col" style={{ marginLeft: largura, transition: 'margin-left .15s', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: 60, background: 'var(--card)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', position: 'sticky', top: 0, zIndex: 20 }}>
          <button className="so-mobile" onClick={() => setMobile(true)} aria-label="Abrir menu" style={{ border: '1px solid var(--line)', background: 'var(--card)', borderRadius: 6, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><Menu size={19} /></button>
          <span className="so-mobile"><LogoMarca size={28} /></span>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setPerfil(p => !p)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', padding: '4px 6px', borderRadius: 6 }}>
              <span style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--teal)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{iniciais(usuario?.name || '')}</span>
              <span className="esconde-mobile" style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{usuario?.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{usuario?.role === 'superadmin' ? 'Administrador do sistema' : usuario?.role === 'admin' ? 'Administrador' : 'Usuário'}</span>
              </span>
              <ChevronDown size={16} color="var(--muted)" />
            </button>
            {perfil && (
              <>
                <div onClick={() => setPerfil(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 220, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, padding: 6, boxShadow: '0 12px 28px rgba(11,20,26,.14)', animation: 'fadeUp .12s ease' }}>
                  <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4, fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{usuario?.email}</div>
                  <button onClick={() => { setPerfil(false); setSenha(true) }} style={itemMenu}><KeyRound size={16} /> Trocar minha senha</button>
                  <button onClick={sair} style={{ ...itemMenu, color: 'var(--perigo)' }}><LogOut size={16} /> Sair</button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="app-main" style={{ padding: '22px 26px 48px', flex: 1, width: '100%', maxWidth: 1400 }}>
          <Outlet />
        </main>
      </div>
      {senha && <TrocarSenha onClose={() => setSenha(false)} />}
    </div>
  );
}

const itemMenu = { width: '100%', textAlign: 'left' as const, display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', border: 'none', background: 'none', borderRadius: 5, fontSize: 14 };

function TrocarSenha({ onClose }: { onClose: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try { await api('POST', '/auth/password', { current: atual, password: nova }); ok('Senha trocada.'); onClose() }
    catch (e) { erro(e) } finally { setSalvando(false) }
  };
  return (
    <Modal title="Trocar minha senha" onClose={onClose}
      footer={<><button style={btn('ghost')} onClick={onClose}>Cancelar</button><button style={btn()} disabled={salvando || nova.length < 6 || !atual} onClick={salvar}>Salvar</button></>}>
      <Campo label="Senha atual"><input type="password" style={inputStyle} value={atual} onChange={e => setAtual(e.target.value)} autoComplete="current-password" /></Campo>
      <Campo label="Nova senha" ajuda="Pelo menos 6 caracteres."><input type="password" style={inputStyle} value={nova} onChange={e => setNova(e.target.value)} autoComplete="new-password" /></Campo>
    </Modal>
  );
}
