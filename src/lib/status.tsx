import { Pilula } from '../components/ui';

export const STATUS_CAMPANHA: Record<string, { label: string; cor: 'verde' | 'cinza' | 'amarelo' | 'vermelho' | 'azul' }> = {
  draft: { label: 'Rascunho', cor: 'cinza' },
  running: { label: 'Enviando', cor: 'verde' },
  paused: { label: 'Pausada', cor: 'amarelo' },
  done: { label: 'Concluída', cor: 'azul' },
  canceled: { label: 'Cancelada', cor: 'vermelho' },
};

export function StatusCampanha({ status }: { status: string }) {
  const s = STATUS_CAMPANHA[status] || { label: status, cor: 'cinza' as const };
  return <Pilula cor={s.cor} pulsando={status === 'running'}>{s.label}</Pilula>;
}

export const STATUS_ALVO: Record<string, { label: string; cor: 'verde' | 'cinza' | 'amarelo' | 'vermelho' | 'azul' }> = {
  pending: { label: 'Na fila', cor: 'cinza' },
  sending: { label: 'Enviando', cor: 'amarelo' },
  sent: { label: 'Enviada', cor: 'verde' },
  failed: { label: 'Falhou', cor: 'vermelho' },
  ringing: { label: 'Chamando', cor: 'amarelo' },
  answered: { label: 'Em ligação', cor: 'azul' },
  completed: { label: 'Atendeu', cor: 'verde' },
  'no-answer': { label: 'Não atendeu', cor: 'cinza' },
};

export function StatusAlvo({ status }: { status: string }) {
  const s = STATUS_ALVO[status] || { label: status, cor: 'cinza' as const };
  return <Pilula cor={s.cor} pulsando={status === 'ringing' || status === 'answered' || status === 'sending'}>{s.label}</Pilula>;
}

export const TIPO_MSG: Record<string, string> = { text: 'Texto', image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' };

export type Stats = { total: number; pending: number; sent: number; failed: number; completed: number; noAnswer: number };
export const feitos = (s: Stats) => s.total - s.pending;
