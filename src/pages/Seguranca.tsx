import { useEffect, useState, type ReactNode } from 'react';
import { RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { api, erro, getUsuario, ok } from '../lib/api';
import { Cabecalho, Card, Carregando, btn, inputStyle } from '../components/ui';

type Admin = Record<string, number | string | boolean | number[]>;
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Linha({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px dashed var(--line)', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{titulo}</div>
        {ajuda && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>{ajuda}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

export default function Seguranca() {
  const [v, setV] = useState<Admin | null>(null);
  const [padrao, setPadrao] = useState<Admin | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api<{ seguranca: Admin; padrao: Admin }>('GET', '/admin/seguranca').then(r => { setV(r.seguranca); setPadrao(r.padrao) }).catch(erro) }, []);
  if (getUsuario()?.role !== 'superadmin') return <p>Área do administrador do sistema.</p>;
  if (!v || !padrao) return <Carregando />;

  const n = (k: string, w = 80, sufixo?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <input type="number" style={{ ...inputStyle, width: w }} value={Number(v[k])} onChange={e => setV({ ...v, [k]: Number(e.target.value) })} />
      {sufixo && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{sufixo}</span>}
    </span>
  );
  const sw = (k: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
      <input type="checkbox" checked={!!v[k]} onChange={e => setV({ ...v, [k]: e.target.checked })} /> {v[k] ? 'Ligado' : 'Desligado'}
    </label>
  );
  const salvar = async () => {
    setSalvando(true);
    try { const r = await api<{ seguranca: Admin }>('PUT', '/admin/seguranca', v); setV(r.seguranca); ok('Segurança salva. Vale pras próximas campanhas.') } catch (e) { erro(e) } finally { setSalvando(false) }
  };
  const dias = (v.diasSemana as number[]) || [];

  return (
    <>
      <Cabecalho titulo="Segurança anti-bloqueio">
        <button style={btn('ghost')} onClick={() => setV({ ...padrao })}><RotateCcw size={15} /> Voltar ao recomendado</button>
        <button style={btn()} disabled={salvando} onClick={salvar}><Save size={15} /> Salvar</button>
      </Cabecalho>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 16px', background: 'var(--verde-soft)', border: '1px solid #BDE9D6', borderRadius: 4, marginBottom: 16, fontSize: 14, lineHeight: 1.55 }}>
        <ShieldCheck size={20} color="var(--verde-escuro)" style={{ flex: 'none', marginTop: 2 }} />
        <span>Esses são os <b>padrões</b> que aparecem pras empresas ao criar campanha e os <b>limites</b> que elas não conseguem furar (intervalo mínimo e máximo de envios por dia). A segurança vale <b>por número de WhatsApp</b>: todas as campanhas do mesmo número dividem o mesmo intervalo, pausa e limite.</span>
      </div>

      <div className="grid-2">
        <Card title="Intervalo entre envios (mesmo número)">
          <Linha titulo="Mensagem: padrão" ajuda="Espera sorteada entre uma mensagem e outra.">{n('intervaloMin', 70)} a {n('intervaloMax', 70, 'segundos')}</Linha>
          <Linha titulo="Ligação: padrão">{n('ligIntervaloMin', 70)} a {n('ligIntervaloMax', 70, 'segundos')}</Linha>
          <Linha titulo="Piso pra mensagem" ajuda="A empresa não consegue configurar menos que isso.">{n('pisoIntervaloMsg', 70, 'segundos')}</Linha>
          <Linha titulo="Piso pra ligação">{n('pisoIntervaloLigacao', 70, 'segundos')}</Linha>
        </Card>
        <Card title="Pausa longa">
          <Linha titulo="A cada" ajuda="Número de envios sorteado nessa faixa.">{n('pausaCadaMin', 70)} a {n('pausaCadaMax', 70, 'envios')}</Linha>
          <Linha titulo="Pausa de">{n('pausaMin', 70)} a {n('pausaMax', 70, 'minutos')}</Linha>
          <Linha titulo="Falhas seguidas pra pausar o número" ajuda="Muitas falhas em sequência costumam ser sinal de bloqueio. 0 desliga.">{n('falhasSeguidas', 70)} → pausa de {n('pausaFalhasMin', 70, 'min')}</Linha>
        </Card>
        <Card title="Limites por número">
          <Linha titulo="Mensagem: por hora / por dia">{n('limiteHora', 80)} / {n('limiteDia', 90)}</Linha>
          <Linha titulo="Ligação: por hora / por dia">{n('ligLimiteHora', 80)} / {n('ligLimiteDia', 90)}</Linha>
          <Linha titulo="Teto do dia" ajuda="Máximo absoluto por número por dia, mesmo que a empresa peça mais.">{n('tetoDia', 90, 'envios')}</Linha>
          <Linha titulo="Aquecimento de número novo" ajuda="O limite do dia começa baixo e cresce todo dia.">{sw('aquecimento')}</Linha>
          <Linha titulo="Aquecimento: 1º dia / aumento por dia">{n('aquecimentoDia1', 70)} / +{n('aquecimentoIncremento', 70)}</Linha>
        </Card>
        <Card title="Horário e cuidados">
          <Linha titulo="Janela de envio (Brasília)">
            <input type="time" style={{ ...inputStyle, width: 110 }} value={String(v.horarioInicio)} onChange={e => setV({ ...v, horarioInicio: e.target.value })} /> às
            <input type="time" style={{ ...inputStyle, width: 110 }} value={String(v.horarioFim)} onChange={e => setV({ ...v, horarioFim: e.target.value })} />
          </Linha>
          <Linha titulo="Dias da semana">
            {DIAS.map((d, i) => (
              <button key={d} type="button" onClick={() => setV({ ...v, diasSemana: dias.includes(i) ? dias.filter(x => x !== i) : [...dias, i].sort() })}
                style={{ padding: '5px 9px', borderRadius: 4, border: `1px solid ${dias.includes(i) ? 'var(--verde)' : 'var(--line)'}`, background: dias.includes(i) ? 'var(--verde-soft)' : 'var(--card)', color: dias.includes(i) ? 'var(--verde-escuro)' : 'var(--muted)', fontWeight: 700, fontSize: 12.5 }}>{d}</button>
            ))}
          </Linha>
          <Linha titulo="Verificar se tem WhatsApp antes de enviar">{sw('verificarWhatsapp')}</Linha>
          <Linha titulo="Pular quem está conversando com a equipe" ajuda="Contato que a equipe respondeu nos últimos 3 dias não recebe disparo.">{sw('pularEmConversa')}</Linha>
          <Linha titulo="Ligação: tempo tocando" ajuda="Sorteado a cada ligação, parece mais humano.">{n('toqueMin', 70)} a {n('toqueMax', 70, 'segundos')}</Linha>
        </Card>
      </div>
    </>
  );
}
