// Segurança anti-bloqueio (modelo InoovaCall): padrões/limites do admin, piso/teto, estado do número.
// Uso: node tests/e2e-seguranca.mjs [http://localhost:3020]
const BASE = (process.argv[2] || 'http://localhost:3020') + '/api';
let ok = 0, falhas = 0;
const check = (c, nome, extra) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } };
async function call(token, metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j };
}
const sufixo = Date.now().toString(36);
const S = (await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: '123456' })).j.token;

console.log('Admin: padrões e limites');
const g = (await call(S, 'GET', '/admin/seguranca')).j;
check(g.seguranca.pisoIntervaloMsg === 8 && g.seguranca.tetoDia === 600 && g.seguranca.aquecimentoDia1 === 25 && g.seguranca.horarioInicio === '09:00', 'padrões do InoovaCall carregados', g.seguranca);
check((await call(S, 'PUT', '/admin/seguranca', { intervaloMin: 50, intervaloMax: 10 })).s === 400, 'recusa máximo menor que o mínimo');
const salvo = await call(S, 'PUT', '/admin/seguranca', { pisoIntervaloMsg: 12, tetoDia: 400 });
check(salvo.s === 200 && salvo.j.seguranca.pisoIntervaloMsg === 12 && salvo.j.seguranca.tetoDia === 400, 'salva piso e teto');

const nova = await call(S, 'POST', '/admin/tenants', { name: 'Seg ' + sufixo, adminName: 'Dono', adminEmail: `seg-${sufixo}@teste.local`, adminPassword: 'senha123' });
const A = (await call(null, 'POST', '/auth/login', { email: `seg-${sufixo}@teste.local`, password: 'senha123' })).j.token;
check((await call(A, 'GET', '/admin/seguranca')).s === 403, 'empresa não mexe na segurança do sistema');

console.log('Padrões na nova campanha');
const pm = (await call(A, 'GET', '/campaigns/seguranca-padrao?kind=message')).j.seguranca;
const pl = (await call(A, 'GET', '/campaigns/seguranca-padrao?kind=call')).j.seguranca;
check(pm.intervaloMin === 20 && pm.limiteDia === 300 && pm.aquecimento === true && pm.verificarWhatsapp === true, 'mensagem: 20–60 s, 300/dia, aquecimento e verificar WhatsApp', pm);
check(pl.intervaloMin === 25 && pl.intervaloMax === 75 && pl.limiteHora === 35 && pl.limiteDia === 180 && pl.toqueMin === 28, 'ligação: 25–75 s, 35/h, 180/dia, toque 28–42 s', pl);

console.log('Cliente não fura piso/teto');
await call(A, 'POST', '/contacts/import', { rows: [{ name: 'Maria', phone: '91988887777' }] });
const conn = (await call(A, 'POST', '/connections', { name: 'Comercial' })).j.connection;
check(conn.seguranca && conn.seguranca.limiteDia === 25 && conn.seguranca.diaAquecimento === 1 && conn.seguranca.dia === 0, 'número novo: aquecimento dia 1 = 25 envios hoje', conn.seguranca);
const c1 = await call(A, 'POST', '/campaigns', { name: 'Rápida', kind: 'message', connectionId: conn.id, messageType: 'text', text: 'Oi', audience: { all: true }, seguranca: { intervaloMin: 1, intervaloMax: 2, limiteDia: 99999, horarioInicio: '07:00', horarioFim: '22:00', diasSemana: [0, 1, 2, 3, 4, 5, 6] } });
const seg1 = c1.j.campaign?.seguranca;
check(c1.s === 201 && seg1.intervaloMin === 12 && seg1.intervaloMax === 12 && seg1.limiteDia === 400, 'intervalo sobe pro piso (12 s) e limite do dia desce pro teto (400)', seg1);
check(seg1.horarioInicio === '07:00' && seg1.diasSemana.length === 7, 'janela de horário da campanha guardada', seg1);
const c2 = await call(A, 'POST', '/campaigns', { name: 'Lig', kind: 'call', connectionId: conn.id, media: null, audience: { all: true } });
check(c2.s === 400, 'ligação continua exigindo o áudio');
const det = (await call(A, 'GET', `/campaigns/${c1.j.campaign.id}`)).j.campaign;
check(det.numero && det.numero.limiteDia === 25 && det.numero.diaAquecimento === 1, 'detalhe da campanha mostra o uso do número (aquecimento)', det.numero);
check((await call(A, 'POST', `/connections/${conn.id}/reset-warmup`)).s === 200, 'reiniciar aquecimento do número');

console.log('Limpeza');
await call(S, 'PUT', '/admin/seguranca', { pisoIntervaloMsg: 8, tetoDia: 600 });
await call(A, 'DELETE', `/campaigns/${c1.j.campaign.id}`);
await call(A, 'DELETE', `/connections/${conn.id}`);
await call(S, 'PATCH', `/admin/tenants/${nova.j.tenant.id}`, { active: false });
await call(S, 'DELETE', `/admin/tenants/${nova.j.tenant.id}`);
console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
