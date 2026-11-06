export const NOME_APP = 'InoovaDisparo';

export function LogoMarca({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="64" height="64" rx="14" fill="#25D366" />
      <path d="M32 13c-10.5 0-19 7.8-19 17.5 0 4.6 1.9 8.8 5.1 11.9L16.5 51l9.3-4.1c1.9.6 4 .9 6.2.9 10.5 0 19-7.8 19-17.5S42.5 13 32 13z" fill="#fff" />
      <path d="M24 31.5 40.5 24l-4.6 16.2-4.3-6-7.6-2.7z" fill="#075E54" />
    </svg>
  );
}

export function Logo({ cor = '#fff', size = 34, fonte = 18 }: { cor?: string; size?: number; fonte?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: cor, whiteSpace: 'nowrap' }}>
      <LogoMarca size={size} />
      <span style={{ fontWeight: 700, fontSize: fonte, letterSpacing: '.02em' }}>
        Inoova<span style={{ color: '#25D366' }}>Disparo</span>
      </span>
    </span>
  );
}
