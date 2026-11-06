// Teste de ponta a ponta da API (sem WhatsApp conectado). Uso: node tests/e2e-api.mjs [http://localhost:3020]
// Cria uma empresa de teste, exercita tudo e apaga a empresa no fim.
const BASE = (process.argv[2] || 'http://localhost:3020') + '/api';
let ok = 0, falhas = 0;
const check = (cond, nome, extra) => { if (cond) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } };

async function call(token, metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let j = null; try { j = await r.json() } catch { /* sem corpo */ }
  return { s: r.status, j };
}

const sufixo = Date.now().toString(36);
const emailAdmin = `dono-${sufixo}@teste.local`;

console.log('Login superadmin');
const sa = await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: '123456' });
check(sa.s === 200 && sa.j.user.role === 'superadmin', 'superadmin entra', sa.j);
const S = sa.j.token;
check((await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: 'errada' })).s === 401, 'senha errada = 401');

console.log('Empresas');
const nova = await call(S, 'POST', '/admin/tenants', { name: 'Loja Teste ' + sufixo, maxConnections: 1, maxContacts: 10, adminName: 'Dono Teste', adminEmail: emailAdmin, adminPassword: 'senha123' });
check(nova.s === 201, 'cria empresa + admin', nova.j);
const tid = nova.j.tenant.id;
check((await call(S, 'POST', '/admin/tenants', { name: 'Outra', adminName: 'Xis', adminEmail: emailAdmin, adminPassword: 'senha123' })).s === 409, 'e-mail repetido = 409');
const lista = await call(S, 'GET', '/admin/tenants');
check(lista.j.tenants.some(t => t.id === tid && t.adminEmail === emailAdmin), 'lista mostra a empresa com o e-mail do admin');
check((await call(S, 'GET', '/contacts')).s === 403, 'superadmin não acessa área da empresa');

console.log('Admin da empresa');
const ad = await call(null, 'POST', '/auth/login', { email: emailAdmin, password: 'senha123' });
check(ad.s === 200 && ad.j.user.empresa?.id === tid, 'admin da empresa entra', ad.j);
const A = ad.j.token;
check((await call(A, 'GET', '/admin/tenants')).s === 403, 'admin da empresa não vê área do superadmin');

const u = await call(A, 'POST', '/users', { name: 'Atendente', email: `atend-${sufixo}@teste.local`, password: 'senha123', role: 'user' });
check(u.s === 201, 'cria usuário da equipe', u.j);
const at = await call(null, 'POST', '/auth/login', { email: `atend-${sufixo}@teste.local`, password: 'senha123' });
const U = at.j.token;
check((await call(U, 'GET', '/users')).s === 403, 'usuário comum não gerencia equipe');
check((await call(A, 'PATCH', `/users/${ad.j.user.id}`, { active: false })).s === 400, 'admin não desativa a si mesmo');

console.log('Categorias e contatos');
const cat = await call(A, 'POST', '/contacts/categories', { name: 'Clientes VIP', color: '#25D366' });
check(cat.s === 201, 'cria categoria', cat.j);
const c1 = await call(A, 'POST', '/contacts', { name: 'Maria', phone: '(91) 98888-7777', categoryId: cat.j.category.id });
check(c1.s === 201 && c1.j.contact.phone === '5591988887777', 'cria contato e normaliza o telefone', c1.j);
check((await call(A, 'POST', '/contacts', { name: 'Maria 2', phone: '5591988887777' })).s === 409, 'telefone repetido = 409');
check((await call(A, 'POST', '/contacts', { name: 'X', phone: '123' })).s === 400, 'telefone inválido = 400');
const imp = await call(A, 'POST', '/contacts/import', { rows: [{ name: 'João', phone: '91 97777-6666' }, { name: 'João dup', phone: '91977776666' }, { name: 'Ruim', phone: 'abc' }, { name: 'Maria Nova', phone: '5591988887777' }, { name: 'Ana', phone: '11 95555-4444' }], categoryId: cat.j.category.id });
check(imp.s === 200 && imp.j.created === 2 && imp.j.updated === 1 && imp.j.invalid === 1 && imp.j.duplicatedInFile === 1, 'importa planilha (2 novos, 1 atualizado, 1 inválido, 1 repetido)', imp.j);
const big = await call(A, 'POST', '/contacts/import', { rows: Array.from({ length: 10 }, (_, i) => ({ name: 'N' + i, phone: '119900000' + String(i).padStart(2, '0') })) });
check(big.s === 400 && /plano permite/.test(big.j.error), 'respeita o limite de contatos do plano', big.j);
const busca = await call(A, 'GET', '/contacts?q=jo');
check(busca.j.total === 1 && busca.j.contacts[0].name === 'João', 'busca por nome');
const porCat = await call(A, 'GET', `/contacts?category=${cat.j.category.id}`);
check(porCat.j.total === 3, 'filtra por categoria', porCat.j.total);
const cats = await call(A, 'GET', '/contacts/categories');
check(cats.j.categories[0].total === 3, 'categoria mostra o total de contatos');

console.log('Conexão (AstraCalls)');
const conn = await call(A, 'POST', '/connections', { name: 'Comercial' });
check(conn.s === 201 && conn.j.connection.connected === false, 'cria número (sessão no AstraCalls)', conn.j);
const cid = conn.j.connection?.id;
check((await call(A, 'POST', '/connections', { name: 'Segundo' })).s === 400, 'respeita o limite de números do plano');
if (cid) {
  const qr = await call(A, 'POST', `/connections/${cid}/qr`);
  check(qr.s === 200, 'pede o QR', qr.j);
  let temQr = false;
  for (let i = 0; i < 10 && !temQr; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const st = await call(A, 'GET', `/connections/${cid}/status`);
    temQr = !!st.j.qr;
  }
  check(temQr, 'QR chega pelo SSE do AstraCalls');
}

console.log('Campanhas');
const semNumero = await call(A, 'POST', '/campaigns', { name: 'X', kind: 'message', connectionId: 999999, messageType: 'text', text: 'oi', minDelay: 10, maxDelay: 20, audience: { all: true } });
check(semNumero.s === 400, 'exige número da empresa');
const semTexto = await call(A, 'POST', '/campaigns', { name: 'X', kind: 'message', connectionId: cid, messageType: 'text', text: '  ', minDelay: 10, maxDelay: 20, audience: { all: true } });
check(semTexto.s === 400, 'exige o texto');
const camp = await call(A, 'POST', '/campaigns', { name: 'Promo ' + sufixo, kind: 'message', connectionId: cid, messageType: 'text', text: 'Oi {primeiro_nome}, {tudo bem|como vai}?', minDelay: 10, maxDelay: 20, audience: { categoryIds: [cat.j.category.id] } });
check(camp.s === 201 && camp.j.total === 3 && camp.j.campaign.status === 'draft', 'cria campanha de mensagem (rascunho, 3 contatos)', camp.j);
const campId = camp.j.campaign?.id;
const ini = await call(A, 'POST', `/campaigns/${campId}/start`);
check(ini.s === 400 && /desconectado/.test(ini.j.error), 'não inicia com número desconectado', ini.j);
const lig = await call(A, 'POST', '/campaigns', { name: 'Ligação', kind: 'call', connectionId: cid, minDelay: 15, maxDelay: 30, audience: { all: true } });
check(lig.s === 400 && /áudio/.test(lig.j.error), 'ligação exige o áudio', lig.j);

// upload + campanha de ligação com áudio
const fd = new FormData();
fd.append('file', new Blob([new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])], { type: 'audio/mpeg' }), 'recado.mp3');
const up = await fetch(BASE + '/campaigns/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + A }, body: fd }).then(r => r.json());
check(!!up.path && up.mime === 'audio/mpeg' && up.name === 'recado.mp3', 'envia arquivo de mídia', up);
const lig2 = await call(A, 'POST', '/campaigns', { name: 'Ligação ' + sufixo, kind: 'call', connectionId: cid, media: up, minDelay: 15, maxDelay: 30, audience: { all: true } });
check(lig2.s === 201 && lig2.j.campaign.messageType === 'audio' && lig2.j.total === 3, 'cria campanha de ligação com áudio (3 contatos)', lig2.j);
const img = await call(A, 'POST', '/campaigns', { name: 'Img', kind: 'message', connectionId: cid, messageType: 'image', media: up, minDelay: 10, maxDelay: 20, audience: { all: true } });
check(img.s === 400, 'arquivo de áudio não serve como imagem');

const lst = await call(A, 'GET', '/campaigns');
check(lst.j.campaigns.length === 2 && lst.j.campaigns.find(c => c.id === campId)?.stats.pending === 3, 'lista campanhas com contadores', lst.j.campaigns?.map(c => c.stats));
const alvos = await call(A, 'GET', `/campaigns/${campId}/targets`);
check(alvos.j.total === 3 && !('astraRef' in alvos.j.targets[0]), 'lista os contatos da campanha');
const can = await call(A, 'POST', `/campaigns/${campId}/cancel`);
check(can.s === 200, 'cancela campanha');
const exp = await fetch(BASE + `/campaigns/${campId}/export`, { headers: { Authorization: 'Bearer ' + A } });
const csv = await exp.text();
check(exp.status === 200 && csv.includes('Situação') && csv.includes('Na fila'), 'exporta relatório CSV');
check((await call(U, 'GET', '/campaigns')).j.campaigns.length === 2, 'usuário comum vê as campanhas da empresa');
const dash = await call(A, 'GET', '/dashboard');
check(dash.s === 200 && dash.j.contatos === 3 && dash.j.dias.length === 7, 'painel com números', dash.j);

console.log('Isolamento entre empresas');
const outra = await call(S, 'POST', '/admin/tenants', { name: 'Outra ' + sufixo, adminName: 'Outro', adminEmail: `outro-${sufixo}@teste.local`, adminPassword: 'senha123' });
const O = (await call(null, 'POST', '/auth/login', { email: `outro-${sufixo}@teste.local`, password: 'senha123' })).j.token;
check((await call(O, 'GET', `/campaigns/${campId}`)).s === 404, 'outra empresa não vê a campanha');
check((await call(O, 'GET', `/connections/${cid}/status`)).s === 404, 'outra empresa não vê o número');
check((await call(O, 'GET', '/contacts')).j.total === 0, 'outra empresa não vê os contatos');

console.log('Limpeza');
await call(A, 'DELETE', `/campaigns/${lig2.j.campaign?.id}`);
await call(A, 'DELETE', `/campaigns/${campId}`);
if (cid) { const d = await call(A, 'DELETE', `/connections/${cid}`); check(d.s === 200, 'remove o número (apaga a sessão no AstraCalls)', d.j) }
check((await call(S, 'DELETE', `/admin/tenants/${tid}`)).s === 400, 'não exclui empresa ativa');
await call(S, 'PATCH', `/admin/tenants/${tid}`, { active: false });
check((await call(A, 'GET', '/contacts')).s === 403, 'empresa desativada perde o acesso na hora');
check((await call(S, 'DELETE', `/admin/tenants/${tid}`)).s === 200, 'exclui empresa desativada');
await call(S, 'PATCH', `/admin/tenants/${outra.j.tenant.id}`, { active: false });
await call(S, 'DELETE', `/admin/tenants/${outra.j.tenant.id}`);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
