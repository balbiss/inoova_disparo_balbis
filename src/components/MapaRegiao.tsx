import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { btn } from './ui';

export type Regiao = { lat: number; lng: number; radiusKm: number; label: string };

const RAIOS = [1, 3, 5, 10];
const BRASIL: [number, number] = [-14.5, -52];
// mapa base do OpenStreetMap (gratuito, sem chave; exige só a atribuição)
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

type Endereco = { suburb?: string; neighbourhood?: string; quarter?: string; city_district?: string; city?: string; town?: string; village?: string; municipality?: string; state?: string; 'ISO3166-2-lvl4'?: string };
type Sugestao = { lat: string; lon: string; display_name: string; address?: Endereco };

/** "Umarizal, Belém - PA" a partir do endereço do OpenStreetMap. */
function rotulo(a?: Endereco, reserva = '') {
  if (!a) return reserva;
  const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district;
  const cidade = a.city || a.town || a.village || a.municipality;
  const uf = a['ISO3166-2-lvl4']?.replace(/^BR-/, '') || a.state;
  const local = [cidade, uf].filter(Boolean).join(' - ');
  return [bairro, local].filter(Boolean).join(', ') || reserva;
}

const pino = L.divIcon({
  className: 'pino-regiao',
  html: '<span class="pino-onda"></span><span class="pino-gota"><span class="pino-miolo"></span></span>',
  iconSize: [36, 46], iconAnchor: [18, 44],
});

/** Janela com mapa: a pessoa clica onde quer buscar, escolhe o raio e confirma. */
export default function MapaRegiao({ inicial, textoInicial, onClose, onEscolher }: { inicial: Regiao | null; textoInicial: string; onClose: () => void; onEscolher: (r: Regiao) => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marca = useRef<L.Marker | null>(null);
  const circulo = useRef<L.Circle | null>(null);
  const [ponto, setPonto] = useState<{ lat: number; lng: number } | null>(inicial ? { lat: inicial.lat, lng: inicial.lng } : null);
  const [raio, setRaio] = useState(inicial?.radiusKm ?? 3);
  const [nome, setNome] = useState(inicial?.label ?? '');
  const [nomeando, setNomeando] = useState(false);
  const [q, setQ] = useState('');
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [procurando, setProcurando] = useState(false);
  const [localizando, setLocalizando] = useState(false);
  const raioRef = useRef(raio);
  raioRef.current = raio;

  // nome do lugar onde o pino caiu
  const nomear = async (lat: number, lng: number) => {
    setNomeando(true);
    try {
      const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=pt-BR`);
      const j = await r.json() as { address?: Endereco };
      setNome(rotulo(j.address, `${lat.toFixed(4)}, ${lng.toFixed(4)}`));
    } catch { setNome(`${lat.toFixed(4)}, ${lng.toFixed(4)}`) } finally { setNomeando(false) }
  };

  const enquadrar = (lat: number, lng: number, km: number) => {
    const m = mapa.current; if (!m) return;
    m.flyToBounds(L.latLng(lat, lng).toBounds(km * 2000 * 1.35), { duration: 0.6, padding: [24, 24] });
  };

  const marcar = (lat: number, lng: number, nomeConhecido?: string) => {
    const m = mapa.current; if (!m) return;
    if (!marca.current) marca.current = L.marker([lat, lng], { icon: pino, draggable: true }).addTo(m)
      .on('dragend', e => { const p = (e.target as L.Marker).getLatLng(); marcar(p.lat, p.lng) });
    else marca.current.setLatLng([lat, lng]);
    if (!circulo.current) circulo.current = L.circle([lat, lng], { radius: raioRef.current * 1000, color: '#00A884', weight: 2, fillColor: '#00A884', fillOpacity: 0.12, dashArray: '6 6', interactive: false }).addTo(m);
    else circulo.current.setLatLng([lat, lng]);
    setPonto({ lat, lng });
    if (nomeConhecido) setNome(nomeConhecido); else nomear(lat, lng);
  };

  // monta o mapa
  useEffect(() => {
    if (!divRef.current || mapa.current) return;
    const m = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView(BRASIL, 4);
    L.tileLayer(TILES, { attribution: ATRIB, maxZoom: 19, className: 'mapa-tiles' }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => marcar(e.latlng.lat, e.latlng.lng));
    mapa.current = m;
    if (inicial) { marcar(inicial.lat, inicial.lng, inicial.label); m.setView([inicial.lat, inicial.lng], 13); enquadrar(inicial.lat, inicial.lng, inicial.radiusKm) }
    else if (textoInicial.trim().length >= 3) {
      // já digitou a cidade: abre o mapa lá
      fetch(`${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(textoInicial)}&countrycodes=br&limit=1&accept-language=pt-BR`)
        .then(r => r.json()).then((l: Sugestao[]) => { if (l[0]) m.flyTo([+l[0].lat, +l[0].lon], 13, { duration: 0.8 }) }).catch(() => {});
    }
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); mapa.current = null; marca.current = null; circulo.current = null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // raio mudou: redesenha o círculo e enquadra
  useEffect(() => {
    circulo.current?.setRadius(raio * 1000);
    if (ponto) enquadrar(ponto.lat, ponto.lng, raio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raio]);

  // busca de cidade/bairro com sugestões
  useEffect(() => {
    if (q.trim().length < 3) { setSugestoes([]); return }
    const t = setTimeout(async () => {
      setProcurando(true);
      try {
        const r = await fetch(`${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=br&limit=5&addressdetails=1&accept-language=pt-BR`);
        setSugestoes(await r.json());
      } catch { setSugestoes([]) } finally { setProcurando(false) }
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  const escolherSugestao = (s: Sugestao) => {
    const lat = +s.lat, lng = +s.lon;
    marcar(lat, lng, rotulo(s.address, s.display_name.split(',').slice(0, 2).join(',')));
    enquadrar(lat, lng, raio);
    setQ(''); setSugestoes([]);
  };

  const minhaLocalizacao = () => {
    if (!navigator.geolocation) return;
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(p => {
      setLocalizando(false);
      marcar(p.coords.latitude, p.coords.longitude);
      enquadrar(p.coords.latitude, p.coords.longitude, raio);
    }, () => setLocalizando(false), { enableHighAccuracy: true, timeout: 10_000 });
  };

  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose]);

  return (
    <div className="mapa-fundo" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="mapa-janela" role="dialog" aria-label="Escolher região no mapa">
        <header className="mapa-topo">
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Onde você quer buscar?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Clique no mapa ou procure a cidade. Dá pra arrastar o pino.</div>
          </div>
          <button className="mapa-fechar" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="mapa-corpo">
          <div ref={divRef} className="mapa-leaflet" />

          <div className="mapa-busca">
            <div style={{ position: 'relative' }}>
              <Search size={16} color="var(--muted)" style={{ position: 'absolute', left: 12, top: 12 }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Procurar cidade ou bairro…" autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && sugestoes[0]) escolherSugestao(sugestoes[0]) }} />
              {procurando && <Loader2 size={15} color="var(--muted)" style={{ position: 'absolute', right: 12, top: 12, animation: 'spin 1s linear infinite' }} />}
            </div>
            {sugestoes.length > 0 && (
              <ul className="mapa-sugestoes">
                {sugestoes.map((s, i) => (
                  <li key={i}><button onClick={() => escolherSugestao(s)}>
                    <MapPin size={15} color="var(--verde-escuro)" style={{ flex: 'none', marginTop: 2 }} />
                    <span><b>{rotulo(s.address, s.display_name.split(',')[0])}</b><small>{s.display_name}</small></span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>

          <button className="mapa-local" onClick={minhaLocalizacao} title="Usar minha localização">
            {localizando ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Crosshair size={18} />}
          </button>

          {!ponto && <div className="mapa-dica"><MapPin size={16} /> Clique no mapa para marcar a região</div>}
        </div>

        <footer className="mapa-rodape">
          <div className="mapa-escolha">
            <span className="mapa-icone"><MapPin size={18} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Região escolhida</div>
              <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {!ponto ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Nenhuma ainda</span> : nomeando ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Descobrindo o lugar…</span> : nome}
              </div>
            </div>
          </div>
          <div className="mapa-raios" role="group" aria-label="Raio da busca">
            <span>Raio</span>
            {RAIOS.map(k => <button key={k} className={raio === k ? 'ativo' : ''} onClick={() => setRaio(k)}>{k} km</button>)}
          </div>
          <button style={btn('primary', { height: 42, padding: '0 22px' })} disabled={!ponto || nomeando}
            onClick={() => ponto && onEscolher({ ...ponto, radiusKm: raio, label: nome })}>Usar esta região</button>
        </footer>
      </div>
    </div>
  );
}
