/** Só dígitos; número brasileiro sem DDI (10 ou 11 dígitos) ganha o 55. Inválido = null. */
export function normalizarTelefone(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return null;
  return d;
}

/** Troca {nome} e {primeiro_nome} no texto e sorteia {opção1|opção2} (variação contra bloqueio). */
export function montarTexto(modelo: string, nome: string) {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || '';
  return modelo
    .replace(/\{primeiro_nome\}/gi, primeiro)
    .replace(/\{nome\}/gi, (nome || '').trim())
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opcoes: string) => {
      const l = opcoes.split('|');
      return l[Math.floor(Math.random() * l.length)];
    });
}
