import { useState, type ReactNode } from 'react';

const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '#';

/** Foto do perfil do WhatsApp; sem foto (ou se não carregar), mostra as iniciais ou o ícone. */
export function Avatar({ url, nome, size = 44, apagado, icone }: { url?: string | null; nome: string; size?: number; apagado?: boolean; icone?: ReactNode }) {
  const [falhou, setFalhou] = useState(false);
  const base = { width: size, height: size, borderRadius: 99, flex: 'none' as const };
  if (url && !falhou) {
    return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFalhou(true)} style={{ ...base, objectFit: 'cover', background: '#E9EDEF', opacity: apagado ? 0.6 : 1 }} />;
  }
  return (
    <span style={{ ...base, background: apagado ? '#EEF1F2' : 'var(--verde-soft)', color: apagado ? 'var(--muted)' : 'var(--verde-escuro)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: Math.round(size * 0.32) }}>
      {icone ?? iniciais(nome)}
    </span>
  );
}
