import type { CSSProperties, ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';

// Peças visuais no padrão do Clara v2 (estrutura do Kommo), pintadas nas cores do WhatsApp.

export const titulo: CSSProperties = { fontFamily: "'PT Sans', Arial, sans-serif", fontWeight: 700 };
export const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #C9D1D5', borderRadius: 4, background: '#fff', fontSize: 14 };
export const labelStyle: CSSProperties = { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 5 };

type Variant = 'primary' | 'ghost' | 'danger' | 'soft' | 'link';
export function btn(variant: Variant = 'primary', extra: CSSProperties = {}): CSSProperties {
  const base: CSSProperties = { minHeight: 36, padding: '0 16px', borderRadius: 4, fontSize: 13, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
  const v: Record<Variant, CSSProperties> = {
    primary: { border: 'none', background: 'var(--verde)', color: '#fff' },
    ghost: { border: '1px solid #C9D1D5', background: '#fff', color: 'var(--ink)' },
    danger: { border: 'none', background: 'var(--perigo)', color: '#fff' },
    soft: { border: 'none', background: 'var(--verde-soft)', color: 'var(--verde-escuro)' },
    link: { border: 'none', background: 'none', color: 'var(--verde-escuro)', padding: '0 6px', textTransform: 'none', letterSpacing: 0 },
  };
  return { ...base, ...v[variant], ...extra };
}

export function Modal({ title, subtitle, onClose, children, footer, width = 480 }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(11,20,26,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 80 }}>
      <div onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: 6, boxShadow: '0 20px 60px rgba(11,20,26,.25)', animation: 'fadeUp .14s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 22px 12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ ...titulo, fontSize: 19, margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.55, margin: '6px 0 0' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Fechar" aria-label="Fechar" style={{ width: 30, height: 30, border: '1px solid var(--line)', borderRadius: 6, background: 'none', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><X size={15} /></button>
        </div>
        <div style={{ padding: '0 22px 18px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, padding: '14px 22px 18px', borderTop: '1px solid var(--line)' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Card({ title, right, children, style, pad = true }: { title?: ReactNode; right?: ReactNode; children?: ReactNode; style?: CSSProperties; pad?: boolean }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 4, ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '13px 16px', borderBottom: pad ? undefined : '1px solid var(--line)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{title}</span>
          {right}
        </div>
      )}
      {children !== undefined && children !== null && children !== false && <div style={{ padding: pad ? (title ? '0 16px 16px' : 16) : 0 }}>{children}</div>}
    </div>
  );
}

export function Campo({ label, children, ajuda, style }: { label: ReactNode; children: ReactNode; ajuda?: ReactNode; style?: CSSProperties }) {
  return (
    <label style={{ display: 'block', marginBottom: 14, ...style }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {ajuda && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>{ajuda}</span>}
    </label>
  );
}

const CORES: Record<string, [string, string]> = {
  verde: ['var(--verde-soft)', 'var(--verde-escuro)'],
  cinza: ['#EEF1F2', '#54656F'],
  amarelo: ['var(--alerta-soft)', '#9A6100'],
  vermelho: ['var(--perigo-soft)', '#C42B30'],
  azul: ['var(--info-soft)', '#1D5FC2'],
};
export function Pilula({ cor = 'cinza', children, pulsando }: { cor?: keyof typeof CORES; children: ReactNode; pulsando?: boolean }) {
  const [bg, fg] = CORES[cor];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 9px', borderRadius: 3, background: bg, color: fg, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {pulsando && <span style={{ width: 7, height: 7, borderRadius: 99, background: fg, animation: 'pulse 1.4s infinite' }} />}
      {children}
    </span>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--muted)', fontSize: 14 }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {texto}
    </div>
  );
}

export function Vazio({ icone, titulo: t, texto, acao }: { icone: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
      <div style={{ width: 56, height: 56, borderRadius: 99, background: 'var(--verde-soft)', color: 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>{icone}</div>
      <div style={{ ...titulo, fontSize: 17, color: 'var(--ink)' }}>{t}</div>
      {texto && <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 14, lineHeight: 1.55 }}>{texto}</p>}
      {acao && <div style={{ marginTop: 18 }}>{acao}</div>}
    </div>
  );
}

/** Cabeçalho de página no estilo Kommo: título em caixa-alta + contagem + ações à direita. */
export function Cabecalho({ titulo: t, contagem, children }: { titulo: string; contagem?: ReactNode; children?: ReactNode }) {
  return (
    <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h1 style={{ ...titulo, fontSize: 22, margin: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t}</h1>
        {contagem !== undefined && <span style={{ color: 'var(--muted)', fontSize: 14 }}>{contagem}</span>}
      </div>
      {children && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export function Progresso({ valor, total, cor = 'var(--verde)' }: { valor: number; total: number; cor?: string }) {
  const pct = total ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: '#E9EDEF', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: cor, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)', width: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

export function Paginacao({ page, per, total, onPage }: { page: number; per: number; total: number; onPage: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / per));
  if (paginas <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 14px', fontSize: 13, color: 'var(--muted)' }}>
      <button style={btn('ghost', { minHeight: 30, padding: '0 10px' })} disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page} de {paginas}</span>
      <button style={btn('ghost', { minHeight: 30, padding: '0 10px' })} disabled={page >= paginas} onClick={() => onPage(page + 1)}>Próxima</button>
    </div>
  );
}
