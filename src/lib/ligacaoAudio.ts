import { api, getToken } from './api';

/**
 * Áudio da ligação pelo WhatsApp no navegador (mesmo esquema do Clara v2 / InoovaCall):
 *  1º tenta WebRTC (melhor qualidade; precisa da porta de mídia do servidor de ligação);
 *  se não conectar em 6 s — ou se a ligação for atendida e o som não chegar — troca pro
 *  WebSocket (PCM 16 kHz passando pela nossa API). O WS abre ANTES de fechar o WebRTC:
 *  fechar primeiro faz o AstraCalls encerrar a chamada.
 */
export interface ConexaoAudio {
  transporte: 'webrtc' | 'websocket';
  mudo: (on: boolean) => void;
  fechar: () => void;
  atendida: () => void;
  aoTrocar?: (t: 'webrtc' | 'websocket') => void;
}

const SAMPLE_RATE = 16_000;
const FRAME = 512;
const diag = (callId: string, dados: Record<string, unknown>) => void api('POST', `/calls/${encodeURIComponent(callId)}/diag`, { ...dados, ua: navigator.userAgent.slice(0, 120) }).catch(() => {});

async function microfone(c?: MediaTrackConstraints): Promise<MediaStream> {
  try { return await navigator.mediaDevices.getUserMedia({ audio: c || { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
  catch { throw new Error('Libere o microfone no navegador pra ligar (ícone de cadeado ao lado do endereço).') }
}

interface Rtc { pc: RTCPeerConnection; mic: MediaStream; fechar: () => void }

async function abrirWebRTC(callId: string, saida: HTMLAudioElement): Promise<Rtc> {
  const mic = await microfone();
  const pc = new RTCPeerConnection({ iceServers: [] });
  mic.getAudioTracks().forEach(t => pc.addTrack(t, mic));
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = ev => { saida.srcObject = ev.streams[0] || new MediaStream([ev.track]); saida.muted = false; void saida.play().catch(() => {}) };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>(ok => {
    if (pc.iceGatheringState === 'complete') return ok();
    const t = setTimeout(ok, 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok() } });
  });
  const r = await api<{ sdp_answer: string }>('POST', `/calls/${encodeURIComponent(callId)}/sdp`, { sdp_offer: pc.localDescription!.sdp });
  await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp_answer });
  return { pc, mic, fechar: () => { mic.getTracks().forEach(t => t.stop()); try { pc.close() } catch { /* */ } saida.srcObject = null } };
}

function iceConectou(pc: RTCPeerConnection, ms: number) {
  return new Promise<boolean>(ok => {
    let fim = false;
    const terminar = (v: boolean) => { if (fim) return; fim = true; clearTimeout(t); pc.removeEventListener('iceconnectionstatechange', mudou); ok(v) };
    const mudou = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') terminar(true);
      else if (s === 'failed' || s === 'closed') terminar(false);
    };
    const t = setTimeout(() => terminar(false), ms);
    pc.addEventListener('iceconnectionstatechange', mudou);
    mudou();
  });
}

async function bytesRecebidos(pc: RTCPeerConnection) {
  let n = 0;
  try { (await pc.getStats()).forEach((r: any) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived || 0 }) } catch { /* */ }
  return n;
}

async function abrirWebSocket(callId: string): Promise<{ mudo: (on: boolean) => void; fechar: () => void }> {
  const mic = await microfone({ sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  const base = location.origin.replace(/^http/, 'ws');
  const ws = new WebSocket(`${base}/api/calls/${encodeURIComponent(callId)}/ws?token=${encodeURIComponent(getToken() || '')}`, ['pcm16']);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((ok, falha) => {
    const t = setTimeout(() => falha(new Error('Tempo esgotado abrindo o áudio pelo servidor.')), 8000);
    ws.onopen = () => { clearTimeout(t); ok() };
    ws.onerror = () => { clearTimeout(t); falha(new Error('Não consegui abrir o áudio da ligação.')) };
  });
  const ctxIn = new AudioContext({ sampleRate: SAMPLE_RATE });
  const fonte = ctxIn.createMediaStreamSource(mic);
  const proc = ctxIn.createScriptProcessor(FRAME, 1, 1);
  let mutado = false;
  proc.onaudioprocess = ev => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const f32 = ev.inputBuffer.getChannelData(0);
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) { const s = mutado ? 0 : Math.max(-1, Math.min(1, f32[i])); out[i] = s < 0 ? s * 32768 : s * 32767 }
    ws.send(out.buffer);
  };
  fonte.connect(proc); proc.connect(ctxIn.destination);
  void ctxIn.resume().catch(() => {});
  const ctxOut = new AudioContext({ sampleRate: SAMPLE_RATE });
  void ctxOut.resume().catch(() => {});
  let cursor = 0;
  ws.onmessage = ev => {
    if (!(ev.data instanceof ArrayBuffer)) return;
    const i16 = new Int16Array(ev.data);
    if (!i16.length) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = ctxOut.createBuffer(1, f32.length, SAMPLE_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctxOut.createBufferSource();
    src.buffer = buf; src.connect(ctxOut.destination);
    const agora = ctxOut.currentTime;
    if (cursor < agora + 0.005) cursor = agora + 0.06;
    src.start(cursor);
    cursor += buf.duration;
  };
  return {
    mudo: on => { mutado = on },
    fechar: () => {
      try { proc.disconnect(); fonte.disconnect() } catch { /* */ }
      void ctxIn.close().catch(() => {}); void ctxOut.close().catch(() => {});
      mic.getTracks().forEach(t => t.stop());
      try { ws.close(1000) } catch { /* */ }
    },
  };
}

export async function abrirAudio(callId: string, saida: HTMLAudioElement): Promise<ConexaoAudio> {
  let rtc: Rtc | null = null;
  let wsc: { mudo: (on: boolean) => void; fechar: () => void } | null = null;
  let mutado = false, fechado = false;
  const conexao: ConexaoAudio = {
    transporte: 'webrtc',
    mudo: on => { mutado = on; rtc?.mic.getAudioTracks().forEach(t => { t.enabled = !on }); wsc?.mudo(on) },
    fechar: () => { fechado = true; rtc?.fechar(); wsc?.fechar() },
    atendida: () => {},
  };
  const trocarParaWS = async (motivo: string) => {
    if (wsc || fechado) return;
    try {
      wsc = await abrirWebSocket(callId);
      wsc.mudo(mutado);
      const antigo = rtc; rtc = null;
      setTimeout(() => antigo?.fechar(), 300);
      conexao.transporte = 'websocket';
      conexao.aoTrocar?.('websocket');
      diag(callId, { evento: 'trocou_para_ws', motivo });
    } catch (e) { diag(callId, { evento: 'ws_falhou', motivo, erro: (e as Error).message }) }
  };
  try { rtc = await abrirWebRTC(callId, saida) }
  catch (e) {
    if ((e as Error).message.startsWith('Libere o microfone')) throw e;
    diag(callId, { evento: 'webrtc_erro', erro: (e as Error).message });
    wsc = await abrirWebSocket(callId);
    conexao.transporte = 'websocket';
    return conexao;
  }
  const conectou = await iceConectou(rtc.pc, 6000);
  diag(callId, { evento: 'ice', conectou });
  if (!conectou) {
    await trocarParaWS('ice_nao_conectou');
    if (!wsc) throw new Error('Não consegui conectar o áudio da ligação.');
    return conexao;
  }
  // atendida: se em 4 s nenhum som chegar pelo WebRTC, troca pro WebSocket
  conexao.atendida = () => {
    if (!rtc) return;
    const pc = rtc.pc;
    void (async () => {
      const a = await bytesRecebidos(pc);
      await new Promise(r => setTimeout(r, 4000));
      if (!rtc || fechado) return;
      const b = await bytesRecebidos(pc);
      diag(callId, { evento: 'som_apos_atender', antes: a, depois: b });
      if (b <= a + 200) await trocarParaWS('sem_som_webrtc');
    })();
  };
  return conexao;
}
