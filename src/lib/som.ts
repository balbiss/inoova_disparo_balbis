// Sons gerados no navegador (sem arquivo): aviso de mensagem nova e toque de ligação chegando.
let ctx: AudioContext | null = null;
const contexto = () => (ctx ||= new AudioContext());

function nota(freq: number, inicio: number, dur: number, vol = 0.18) {
  const c = contexto();
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + inicio);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + inicio + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + inicio + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + inicio); o.stop(c.currentTime + inicio + dur + 0.05);
}

/** "Plim" curto de mensagem nova. */
export function somMensagem() {
  try { void contexto().resume(); nota(880, 0, 0.18); nota(1320, 0.12, 0.25) } catch { /* navegador sem áudio */ }
}

/** Toque de ligação chegando (repete até parar). */
export function tocarChamada(): () => void {
  let ativo = true;
  const tocar = () => {
    if (!ativo) return;
    try { void contexto().resume(); for (let i = 0; i < 4; i++) { nota(660, i * 0.25, 0.2, 0.22); nota(880, i * 0.25 + 0.1, 0.12, 0.15) } } catch { /* */ }
    setTimeout(tocar, 2600);
  };
  tocar();
  return () => { ativo = false };
}

/** Notificação do sistema (se a pessoa permitiu). */
export function notificar(titulo: string, corpo: string, aoClicar?: () => void) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible' && document.hasFocus()) return;
    const n = new Notification(titulo, { body: corpo, icon: '/icon-192.png', tag: 'inoova-' + titulo });
    n.onclick = () => { window.focus(); aoClicar?.(); n.close() };
  } catch { /* */ }
}
