// Leitura simples de CSV (Excel salva com ";" no Brasil, Google Planilhas com ",") e de lista colada.

function detectarSeparador(linha: string) {
  const conta = (s: string) => linha.split(s).length - 1;
  return [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0];
}

export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = detectarSeparador(primeira);
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(c => c.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some(c => c.trim())) linhas.push(linha);
  return linhas.map(l => l.map(c => c.trim()));
}

const pareceTelefone = (v: string) => v.replace(/\D/g, '').length >= 10 && /^[\d\s()+\-.]+$/.test(v.trim());

/** Descobre se a 1ª linha é cabeçalho e quais colunas são nome e telefone. */
export function mapearColunas(linhas: string[][]) {
  const cab = linhas[0] || [];
  const temCabecalho = cab.length > 0 && !cab.some(pareceTelefone);
  const amostra = linhas.slice(temCabecalho ? 1 : 0, 30);
  const n = Math.max(...linhas.map(l => l.length), 0);
  let tel = -1, nome = -1;
  if (temCabecalho) {
    tel = cab.findIndex(c => /tel|fone|celular|whats|n[uú]mero|phone/i.test(c));
    nome = cab.findIndex(c => /nome|name|cliente/i.test(c));
  }
  if (tel < 0) {
    let melhor = 0;
    for (let i = 0; i < n; i++) {
      const q = amostra.filter(l => pareceTelefone(l[i] || '')).length;
      if (q > melhor) { melhor = q; tel = i }
    }
  }
  if (nome < 0) nome = [...Array(n).keys()].find(i => i !== tel && amostra.some(l => /[a-zà-ú]/i.test(l[i] || ''))) ?? -1;
  return { temCabecalho, tel, nome, colunas: n, cabecalho: temCabecalho ? cab : [...Array(n).keys()].map(i => `Coluna ${i + 1}`) };
}

/** Lista colada: uma pessoa por linha, "Nome;telefone", "Nome - telefone" ou só o telefone. */
export function lerLista(texto: string) {
  return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)[\s;,\-–|:]*(\+?[\d\s().\-]{10,})\s*$/);
    if (m) return { name: m[1].replace(/[;,\-–|:]+$/, '').trim(), phone: m[2] };
    return { name: '', phone: l };
  });
}
