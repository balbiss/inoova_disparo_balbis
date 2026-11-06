export const NOME_APP = 'InoovaDisparo';

// Logomarca oficial (public/logo): "escura" = original (texto preto) pra fundo claro;
// "branca" = mesmo desenho com o "Inoova" em branco pra fundo verde-escuro.
// Proporção da arte cortada: 610 x 127.

export function LogoMarca({ size = 34 }: { size?: number }) {
  return <img src="/logo/icone.png" alt="" width={size} height={size} style={{ flex: 'none', display: 'block' }} />;
}

export function Logo({ variante = 'branca', largura = 170 }: { variante?: 'branca' | 'escura'; largura?: number }) {
  return (
    <img src={variante === 'branca' ? '/logo/logo-branca.png' : '/logo/logo-escura.png'} alt={NOME_APP}
      width={largura} height={Math.round(largura * 127 / 610)} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
  );
}
