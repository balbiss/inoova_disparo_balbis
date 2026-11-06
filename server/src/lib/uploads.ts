import fs from 'node:fs';
import path from 'node:path';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Caminho seguro dentro da pasta de uploads (o nome vem do banco, nunca do usuário). */
export function arquivoUpload(nome: string) {
  const p = path.resolve(UPLOAD_DIR, path.basename(nome));
  if (!p.startsWith(UPLOAD_DIR)) throw new Error('caminho inválido');
  return p;
}

const cache = new Map<string, string>();
/** Arquivo em base64 (guardado em memória: a mesma mídia vai pra todos os contatos da campanha). */
export function base64DoUpload(nome: string) {
  let b = cache.get(nome);
  if (!b) {
    b = fs.readFileSync(arquivoUpload(nome)).toString('base64');
    if (cache.size > 20) cache.clear();
    cache.set(nome, b);
  }
  return b;
}
