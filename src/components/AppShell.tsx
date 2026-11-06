import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Telefone } from './Telefone';
import { notificar, somMensagem } from '../lib/som';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BellRing, Building2, MapPinned, MessagesSquare, ChevronUp, KeyRound, LayoutDashboard, LogOut, Megaphone, Menu, MessageCircle, PanelLeft, ShieldCheck, Smartphone, Users, UsersRound, X } from 'lucide-react';
import { api, erro, getUsuario, ok, sair, salvarSessao, getToken, type Usuario } from '../lib/api';
import { Logo, LogoMarca } from './Logo';
import { Campo, Modal, btn, inputStyle } from './ui';

type Item = { to: string; label: string; icon: ReactNode; badge?: number };

function menuDe(u: Usuario | null, naoLidas: number): Item[] {
  if (!u) return [];
  if (u.role === 'superadmin') return [
    { to: '/empresas', label: 'Empresas', icon: <Building2 size={20} /> },
    { to: '/seguranca', label: 'Segurança', icon: <ShieldCheck size={20} /> },
  ];
  const l: Item[] = [
    { to: '/painel', label: 'Painel', icon: <LayoutDashboard size={20} /> },
    { to: '/campanhas', label: 'Campanhas', icon: <Megaphone size={20} /> },
    { to: '/conversas', label: 'Conversas', icon: <MessageCircle size={20} />, badge: naoLidas },
    { to: '/contatos', label: 'Contatos', icon: <UsersRound size={20} /> },
    { to: '/grupos', label: 'Grupos', icon: <MessagesSquare size={20} /> },
    { to: '/leads', label: 'Extrator de leads', icon: <MapPinned size={20} /> },
    { to: '/conexoes', label: 'Conexões', icon: <Smartphone size={20} /> },
  ];
  if (u.role === 'admin') l.push({ to: '/equipe', label: 'Equipe', icon: <Users size={20} /> });
  return l;
}

const papel = (u: Usuario | null) => (u?.role === 'superadmin' ? 'Administrador do sistema' : u?.role === 'admin' ? 'Administrador' : 'Usuário');

/** Perfil no rodapé do menu lateral: foto (iniciais), nome, cargo; menu abre pra cima. */
function PerfilLateral({ usuario, compacto, onSenha }: { usuario: Usuario | null; compacto: boolean; onSenha: () => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div style={{ position: 'relative', padding: 10, borderTop: '1px solid rgba(255,255,255,.1)' }}>
      <button onClick={() => setAberto(a => !a)} title={compacto ? usuario?.name : undefined} aria-label="Minha conta"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: compacto ? '6px 0' : '8px 10px', justifyContent: compacto ? 'center' : 'flex-start', border: 'none', borderRadius: 10, background: aberto ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)', color: '#fff', textAlign: 'left' }}>
        <span style={{ width: 36, height: 36, borderRadius: 99, background: '#25D366', color: '#073B33', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>{iniciais(usuario?.name || '')}</span>
        {!compacto && (
          <>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario?.name}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--side-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{papel(usuario)}</span>
            </span>
            <ChevronUp size={16} color="var(--side-muted)" style={{ transform: aberto ? 'none' : 'rotate(180deg)', transition: 'transform .15s' }} />
          </>
        )}
      </button>
      {aberto && (
        <>
          <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />
          <div style={{ position: 'absolute', left: 10, bottom: 'calc(100% - 4px)', zIndex: 40, width: compacto ? 230 : 'calc(100% - 20px)', minWidth: 210, background: 'var(--card)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, padding: 6, boxShadow: '0 -12px 28px rgba(11,20,26,.18)', animation: 'fadeUp .12s ease' }}>
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{usuario?.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{usuario?.email}</div>
            </div>
            <button onClick={() => { setAberto(false); onSenha() }} style={itemMenu}><KeyRound size={16} /> Trocar minha senha</button>
            <button onClick={sair} style={{ ...itemMenu, color: 'var(--perigo)' }}><LogOut size={16} /> Sair</button>
          </div>
        </>
      )}
    </div>
  );
}

const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// itens do menu são BOTÕES (não links): o navegador não mostra o endereço no canto ao passar o mouse
function Navegacao({ itens, compacto, onClick }: { itens: Item[]; compacto: boolean; onClick?: () => void }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px' }}>
      {itens.map(i => {
        const ativo = pathname === i.to || pathname.startsWith(i.to + '/');
        return (
          <button key={i.to} type="button" onClick={() => { nav(i.to); onClick?.() }} title={compacto ? i.label : undefined} aria-current={ativo ? 'page' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: compacto ? '11px 0' : '10px 12px', justifyContent: compacto ? 'center' : 'flex-start',
              border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
              borderRadius: 6, color: ativo ? '#fff' : 'var(--side-ink)', background: ativo ? 'var(--side-active)' : 'transparent',
              fontSize: 14.5, fontWeight: ativo ? 700 : 400, position: 'relative',
              boxShadow: ativo ? 'inset 3px 0 0 #25D366' : undefined,
            }}>
            {i.icon}
            {!compacto && <span style={{ flex: 1 }}>{i.label}</span>}
            {!!i.badge && (
              <span style={{ position: compacto ? 'absolute' : 'static', top: 4, right: 10, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 99, background: '#25D366', color: '#073B33', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i.badge > 99 ? '99+' : i.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const [usuario, setUsuario] = useState<Usuario | null>(getUsuario());
  const [aberto, setAberto] = useState(() => localStorage.getItem('menu_compacto') !== '1');
  const [mobile, setMobile] = useState(false);
  const [senha, setSenha] = useState(false);
  const loc = useLocation();
  const navegar = useNavigate();
  const [permissao, setPermissao] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const [naoLidas, setNaoLidas] = useState(0);
  const itens = menuDe(usuario, naoLidas);

  // contador de conversas não lidas no menu (a cada 10 s) + som e notificação quando chega resposta nova
  const ultimoNaoLidas = useRef<number | null>(null);
  useEffect(() => {
    if (!usuario?.tenantId) return;
    const ver = () => api<{ unread: number }>('GET', '/conversations/unread').then(async r => {
      setNaoLidas(r.unread);
      if (ultimoNaoLidas.current !== null && r.unread > ultimoNaoLidas.current) {
        somMensagem();
        const u = await api<{ conversations: { id: number; name: string; waName: string | null; phone: string; lastPreview: string }[] }>('GET', '/conversations?filter=nao_lidas&per=10').catch(() => null);
        const c = u?.conversations[0];
        if (c) notificar(`💬 ${c.name || c.waName || c.phone}`, c.lastPreview, () => navegar(`/conversas?c=${c.id}`));
      }
      ultimoNaoLidas.current = r.unread;
    }).catch(() => {});
    ver();
    const t = setInterval(ver, 10000);
    return () => clearInterval(t);
  }, [usuario?.tenantId, loc.pathname]);

  // atualiza o perfil ao abrir (limites da empresa / papel podem mudar)
  useEffect(() => {
    api<{ user: Usuario }>('GET', '/auth/me').then(r => { setUsuario(r.user); salvarSessao(getToken()!, r.user) }).catch(() => {});
  }, []);
  useEffect(() => { setMobile(false) }, [loc.pathname]);

  const alternar = () => setAberto(a => { localStorage.setItem('menu_compacto', a ? '1' : '0'); return !a });
  const largura = aberto ? 224 : 68;

  return (
    <div style={{ minHeight: '100%' }}>
      <aside className="app-sidebar" style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: largura, background: 'var(--side)', color: 'var(--side-ink)', display: 'flex', flexDirection: 'column', zIndex: 30, transition: 'width .15s' }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: aberto ? 'space-between' : 'center', padding: aberto ? '0 10px 0 18px' : 0, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          {aberto ? <Logo largura={160} /> : <button onClick={alternar} title="Abrir menu" style={{ border: 'none', background: 'none', padding: 0, display: 'flex' }}><LogoMarca size={34} /></button>}
          {aberto && <button onClick={alternar} title="Recolher menu" aria-label="Recolher menu" style={{ width: 30, height: 30, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,.08)', color: 'var(--side-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><PanelLeft size={16} /></button>}
        </div>
        {usuario?.empresa && aberto && (
          <div style={{ padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--side-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario.empresa.name}</div>
        )}
        <Navegacao itens={itens} compacto={!aberto} />
        <div style={{ flex: 1 }} />
        {usuario?.tenantId && permissao === 'default' && aberto && (
          <button onClick={() => void Notification.requestPermission().then(p => setPermissao(p))} style={{ margin: '0 10px 8px', padding: '9px 12px', border: '1px dashed rgba(255,255,255,.3)', borderRadius: 10, background: 'none', color: 'var(--side-ink)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
            <BellRing size={16} /> Ativar avisos de resposta nova
          </button>
        )}
        <PerfilLateral usuario={usuario} compacto={!aberto} onSenha={() => setSenha(true)} />
      </aside>

      {mobile && (
        <div onClick={() => setMobile(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(11,20,26,.45)', zIndex: 60 }}>
          <aside onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 260, background: 'var(--side)', animation: 'slideIn .18s ease', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 0 18px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
              <Logo largura={170} />
              <button onClick={() => setMobile(false)} aria-label="Fechar menu" style={{ border: 'none', background: 'none', color: '#fff', padding: 6 }}><X size={20} /></button>
            </div>
            {usuario?.empresa && <div style={{ padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--side-muted)' }}>{usuario.empresa.name}</div>}
            <Navegacao itens={itens} compacto={false} onClick={() => setMobile(false)} />
            <div style={{ flex: 1 }} />
            <PerfilLateral usuario={usuario} compacto={false} onSenha={() => { setMobile(false); setSenha(true) }} />
          </aside>
        </div>
      )}

      <div className="content-col" style={{ marginLeft: largura, transition: 'margin-left .15s', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        <header className="topo-mobile" style={{ height: 60, background: 'var(--card)', borderBottom: '1px solid var(--line)', alignItems: 'center', gap: 12, padding: '0 14px', position: 'sticky', top: 0, zIndex: 20 }}>
          <button onClick={() => setMobile(true)} aria-label="Abrir menu" style={{ border: '1px solid var(--line)', background: 'var(--card)', borderRadius: 8, width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Menu size={19} /></button>
          <Logo variante="escura" largura={140} />
          <div style={{ flex: 1 }} />
          <button onClick={() => setMobile(true)} aria-label="Minha conta" style={{ width: 34, height: 34, borderRadius: 99, border: 'none', background: 'var(--teal)', color: '#fff', fontSize: 13, fontWeight: 700 }}>{iniciais(usuario?.name || '')}</button>
        </header>
        <main className={'app-main' + (loc.pathname.startsWith('/conversas') ? ' app-main-chat' : '')} style={{ padding: loc.pathname.startsWith('/conversas') ? '16px 20px 12px' : '22px 26px 48px', flex: 1, width: '100%', maxWidth: loc.pathname.startsWith('/conversas') ? 'none' : 1400 }}>
          <Outlet />
        </main>
      </div>
      {senha && <TrocarSenha onClose={() => setSenha(false)} />}
      {usuario?.tenantId && <Telefone />}
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
