import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, salvarSessao, type Usuario } from '../lib/api';
import { Logo } from '../components/Logo';

// Login no layout da entrada de conta do Kommo (igual ao Clara v2): painel colorido com o formulário
// + área da marca. Aqui o painel é o verde-escuro do WhatsApp.
const field: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', background: '#fff', borderRadius: 4, marginBottom: 14 };
const inputCss: CSSProperties = { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'none', fontSize: 15, color: '#111B21' };

const UserIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="1.7"><circle cx="12" cy="9" r="4" /><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" /></svg>);
const LockIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="1.7"><rect x="5" y="10.5" width="14" height="10.5" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>);

export default function Login() {
  const [email, setEmail] = useState(localStorage.getItem('email_lembrado') || '');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState('');

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setCarregando(true); setMsg('');
    try {
      const r = await api<{ token: string; user: Usuario }>('POST', '/auth/login', { email, password: senha });
      salvarSessao(r.token, r.user);
      localStorage.setItem('email_lembrado', email);
      window.location.href = r.user.role === 'superadmin' ? '/empresas' : '/painel';
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally { setCarregando(false) }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <aside className="login-painel" style={{ width: 380, flex: 'none', background: 'var(--teal)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 38px', position: 'relative' }}>
        <div style={{ marginBottom: 40 }}><Logo size={42} fonte={24} /></div>
        <form onSubmit={entrar} style={{ width: '100%' }}>
          <label style={field}><UserIcon /><input value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="E-mail" autoComplete="username" style={inputCss} /></label>
          <label style={field}><LockIcon /><input value={senha} onChange={e => setSenha(e.target.value)} type="password" required placeholder="Senha" autoComplete="current-password" style={inputCss} /></label>
          {msg && <p role="alert" style={{ background: 'rgba(229,72,77,.18)', color: '#FFD9DA', fontWeight: 700, fontSize: 14, margin: '0 0 12px', padding: '8px 10px', borderRadius: 4 }}>{msg}</p>}
          <button type="submit" disabled={carregando} style={{ width: '100%', height: 40, background: 'var(--verde-zap)', color: '#073B33', border: 'none', borderRadius: 4, fontSize: 15.5, fontWeight: 700 }}>
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <span style={{ position: 'absolute', bottom: 26, fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)' }}>Disparos pelo WhatsApp</span>
      </aside>
      <main className="login-marca" style={{ flex: 1, minWidth: 0, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', backgroundImage: 'radial-gradient(circle at 70% 30%, #E7F8F1 0, transparent 55%)' }}>
        <Logo cor="#111B21" size={84} fonte={44} />
        <p style={{ margin: '26px 0 0', fontSize: 19, color: 'var(--muted)', maxWidth: 520, lineHeight: 1.5 }}>Campanhas de mensagem e de ligação pelo WhatsApp, com relatório de cada contato.</p>
      </main>
    </div>
  );
}
