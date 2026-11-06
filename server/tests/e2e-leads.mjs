// Extrator de leads (com o gosom SIMULADO: node scripts/gmaps-mock.mjs + GMAPS_URL=http://localhost:8099).
// Uso: node tests/e2e-leads.mjs [http://localhost:3020]
const BASE = (process.argv[2] || 'http://localhost:3020') + '/api';
let ok = 0, falhas = 0;
const check = (c, nome, extra) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function call(token, metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j, r };
}
async function esperarFim(A, id, ms = 40_000) {
  const ini = Date.now();
  while (Date.now() - ini < ms) {
    const r = await call(A, 'GET', `/lead-searches/${id}`);
    if (['done', 'failed'].includes(r.j?.search?.status)) return r.j;
    await espera(2000);
  }
  return (await call(A, 'GET', `/lead-searches/${id}`)).j;
}
const sufixo = Date.now().toString(36);
const S = (await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: '123456' })).j.token;
const nova = await call(S, 'POST', '/admin/tenants', { name: 'Leads ' + sufixo, adminName: 'Dono', adminEmail: `leads-${sufixo}@teste.local`, adminPassword: 'senha123' });
const A = (await call(null, 'POST', '/auth/login', { email: `leads-${sufixo}@teste.local`, password: 'senha123' })).j.token;

console.log('Busca');
check((await call(A, 'GET', '/lead-searches')).j.configurado === true, 'extrator configurado no servidor');
check((await call(A, 'POST', '/lead-searches', { query: 'a' })).s === 400, 'exige o que procurar');
let r = await call(A, 'POST', '/lead-searches', { query: 'loja de móveis', location: 'Ananindeua, PA', maxResults: 50 });
check(r.s === 201 && ['pending', 'working'].includes(r.j.search.status), 'cria a busca', r.j);
const id = r.j.search.id;
check((await call(A, 'POST', '/lead-searches', { query: 'outra coisa' })).s === 409, 'uma busca por vez');
const fim = await esperarFim(A, id);
check(fim.search.status === 'done', 'busca termina (acompanhamento automático)', fim.search);
check(fim.leads.length === 4, '4 empresas (a repetida pelo telefone ficou de fora)', fim.leads.map(l => l.name));
const bela = fim.leads.find(l => l.name === 'Móveis Bela Casa');
check(bela && bela.phone === '5591981234567' && bela.mobile && bela.emails === 'contato@belacasa.com.br' && bela.rating === '4.7', 'lê nome, telefone, celular, e-mail e nota', bela);
const est = fim.leads.find(l => l.name.startsWith('Estofados'));
check(est && est.name === 'Estofados "Conforto" & Cia' && est.phone === '559132551020' && !est.mobile, 'aspas no nome e telefone fixo (não é celular)', est);
const casa = fim.leads.find(l => l.name === 'Casa & Decoração');
check(casa && casa.phone === null && casa.address.includes('Cidade Nova'), 'empresa sem telefone e endereço com quebra de linha', casa);
check(fim.leads[0].mobile, 'celulares aparecem primeiro');
const lista = (await call(A, 'GET', '/lead-searches')).j.searches[0];
check(lista.total === 4 && lista.comTelefone === 3 && lista.celulares === 2, 'histórico mostra totais (4, 3 com telefone, 2 celulares)', lista);

console.log('Salvar e planilha');
r = await call(A, 'POST', `/lead-searches/${id}/import`, { somenteCelular: true, newCategory: 'Móveis Ananindeua' });
check(r.s === 200 && r.j.created === 2 && r.j.categoryId, 'salva só os celulares numa categoria nova', r.j);
const cats = (await call(A, 'GET', '/contacts/categories')).j.categories;
check(cats.some(c => c.name === 'Móveis Ananindeua' && c.total === 2), 'categoria criada com os 2 contatos');
r = await call(A, 'POST', `/lead-searches/${id}/import`, {});
check(r.s === 200 && r.j.created === 1 && r.j.updated === 2, 'salvar todos de novo não duplica (1 novo, 2 já existiam)', r.j);
check((await call(A, 'GET', `/lead-searches/${id}`)).j.leads.filter(l => l.imported).length === 3, 'marca os leads salvos');
const ex = await fetch(BASE + `/lead-searches/${id}/export`, { headers: { Authorization: 'Bearer ' + A } });
const csv = await ex.text();
check(ex.status === 200 && csv.includes('Móveis Bela Casa') && csv.includes('Celular'), 'baixa a planilha');

console.log('Falha e isolamento');
r = await call(A, 'POST', '/lead-searches', { query: 'FALHAR teste' });
const f2 = await esperarFim(A, r.j.search.id);
check(f2.search.status === 'failed' && /Google|minutos/.test(f2.search.error), 'busca que falha mostra o motivo', f2.search);
const outra = await call(S, 'POST', '/admin/tenants', { name: 'Outra ' + sufixo, adminName: 'Outro', adminEmail: `outro3-${sufixo}@teste.local`, adminPassword: 'senha123' });
const O = (await call(null, 'POST', '/auth/login', { email: `outro3-${sufixo}@teste.local`, password: 'senha123' })).j.token;
check((await call(O, 'GET', `/lead-searches/${id}`)).s === 404, 'outra empresa não vê a busca');
check((await call(A, 'DELETE', `/lead-searches/${id}`)).s === 200, 'apaga a busca');

for (const t of [nova.j.tenant.id, outra.j.tenant.id]) { await call(S, 'PATCH', `/admin/tenants/${t}`, { active: false }); await call(S, 'DELETE', `/admin/tenants/${t}`) }
console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
