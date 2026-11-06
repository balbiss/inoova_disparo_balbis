import Swal from 'sweetalert2';

export type Usuario = {
  id: number; name: string; email: string; role: 'superadmin' | 'admin' | 'user'; tenantId: number | null;
  empresa: { id: number; name: string; maxConnections: number; maxContacts: number } | null;
};

export const getToken = () => localStorage.getItem('token');
export const getUsuario = (): Usuario | null => {
  try { return JSON.parse(localStorage.getItem('usuario') || 'null') } catch { return null }
};
export function salvarSessao(token: string, u: Usuario) {
  localStorage.setItem('token', token);
  localStorage.setItem('usuario', JSON.stringify(u));
}
export function sair() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  window.location.href = '/login';
}

export class ApiErro extends Error { constructor(msg: string, public status: number) { super(msg) } }

export async function api<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const ehForm = corpo instanceof FormData;
  const r = await fetch('/api' + caminho, {
    method: metodo,
    headers: { ...(ehForm || corpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
    body: corpo === undefined ? undefined : ehForm ? corpo : JSON.stringify(corpo),
  });
  if (r.status === 401 && caminho !== '/auth/login') { sair(); throw new ApiErro('Sessão expirada', 401) }
  let j: any = null;
  try { j = await r.json() } catch { /* sem corpo */ }
  if (!r.ok) throw new ApiErro(j?.error || `Erro ${r.status}`, r.status);
  return j as T;
}

/** Baixa um arquivo autenticado (ex.: relatório CSV). */
export async function baixar(caminho: string, nome: string) {
  const r = await fetch('/api' + caminho, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!r.ok) return erro('Não foi possível baixar o arquivo.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3200, timerProgressBar: true });
export const ok = (title: string) => void toast.fire({ icon: 'success', title });
export const erro = (e: unknown) => void toast.fire({ icon: 'error', title: e instanceof Error ? e.message : String(e), timer: 5000 });

export async function confirmar(titulo: string, texto = '', botao = 'Confirmar', perigo = false) {
  const r = await Swal.fire({
    title: titulo, text: texto, icon: perigo ? 'warning' : 'question', showCancelButton: true,
    confirmButtonText: botao, cancelButtonText: 'Cancelar', reverseButtons: true,
    confirmButtonColor: perigo ? '#E5484D' : '#00A884', cancelButtonColor: '#8696A0',
  });
  return r.isConfirmed;
}

export const fmtData = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtTel = (t: string | null | undefined) => {
  if (String(t || '').endsWith('@g.us')) return 'Grupo do WhatsApp';
  const d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4), n = d.slice(4);
    return `(${ddd}) ${n.length === 9 ? n.slice(0, 5) + '-' + n.slice(5) : n.slice(0, 4) + '-' + n.slice(4)}`;
  }
  return d ? '+' + d : '—';
};
export const fmtNum = (n: number) => n.toLocaleString('pt-BR');
