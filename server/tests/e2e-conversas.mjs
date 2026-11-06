// Teste da aba Conversas, webhooks do AstraCalls (assinados), descadastro, saúde do número e
// recursos novos de campanha. Precisa da API com ENABLE_TEST_ROUTES=1.
// Uso: node tests/e2e-conversas.mjs [http://localhost:3020]
import crypto from 'node:crypto';
const BASE = (process.argv[2] || 'http://localhost:3020') + '/api';
let ok = 0, falhas = 0;
const check = (c, nome, extra) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } };
const espera = ms => new Promise(r => setTimeout(r, ms));

async function call(token, metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let j = null; try { j = await r.json() } catch { /* sem corpo */ }
  return { s: r.status, j };
}

const sufixo = Date.now().toString(36);
const S = (await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: '123456' })).j.token;
const nova = await call(S, 'POST', '/admin/tenants', { name: 'Conversas ' + sufixo, maxConnections: 2, maxContacts: 100, adminName: 'Dono', adminEmail: `conv-${sufixo}@teste.local`, adminPassword: 'senha123' });
const tid = nova.j.tenant.id;
const A = (await call(null, 'POST', '/auth/login', { email: `conv-${sufixo}@teste.local`, password: 'senha123' })).j.token;

console.log('Preparação');
await call(A, 'POST', '/contacts/import', { rows: [{ name: 'Maria Silva', phone: '91988887777' }, { name: 'João Souza', phone: '11977776666' }, { name: 'Ana', phone: '21966665555' }] });
const conn = (await call(A, 'POST', '/connections', { name: 'Comercial' })).j.connection;
check(!!conn?.id && conn.health !== undefined, 'conexão traz o bloco de saúde', conn);
const seg = (await call(A, 'GET', `/_test/connections/${conn.id}/secret`)).j;
check(!!seg?.secret, 'rota de teste devolve o segredo do webhook (só em dev)');

async function webhook(event, data, segredo = seg.secret) {
  const corpo = JSON.stringify({ session: seg.sessionId, event, timestamp: Date.now(), data });
  const sig = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
  const r = await fetch(BASE + `/webhooks/astra/${conn.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig }, body: corpo });
  await espera(250);
  return r.status;
}

console.log('Campanha com botões, versões e enquete');
const base = { kind: 'message', connectionId: conn.id, minDelay: 10, maxDelay: 20, audience: { all: true } };
let r = await call(A, 'POST', '/campaigns', { ...base, name: 'Botões', messageType: 'text', text: 'Oi {primeiro_nome}', buttons: [{ type: 'cta_url', text: 'Site', value: 'nao-e-link' }] });
check(r.s === 400 && /link/.test(r.j.error), 'botão de link exige https://', r.j);
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Botões', messageType: 'text', text: 'Oi', buttons: [{ type: 'quick_reply', text: 'A' }, { type: 'quick_reply', text: 'B' }, { type: 'quick_reply', text: 'C' }], optOutButton: true });
check(r.s === 400 && /3 botões/.test(r.j.error), 'no máximo 3 botões contando o "Não tenho interesse"', r.j);
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Enquete', messageType: 'poll', text: 'Qual horário?', pollOptions: ['Manhã'] });
check(r.s === 400 && /2 opções/.test(r.j.error), 'enquete exige 2 opções', r.j);
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Enquete ' + sufixo, messageType: 'poll', text: 'Qual horário?', pollOptions: ['Manhã', 'Tarde'] });
check(r.s === 201 && r.j.campaign.pollOptions.length === 2, 'cria campanha de enquete', r.j);
const enquete = r.j.campaign;
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Promo ' + sufixo, messageType: 'text', text: 'Oi {primeiro_nome}! Versão A', textVariants: ['Olá {primeiro_nome}! Versão B', '  '], buttons: [{ type: 'quick_reply', text: 'Quero saber mais' }, { type: 'cta_url', text: 'Ver site', value: 'https://inoovaweb.com.br' }], optOutButton: true, footer: 'Loja Teste' });
check(r.s === 201 && r.j.campaign.textVariants.length === 1 && r.j.campaign.buttons.length === 2 && r.j.campaign.optOutButton, 'cria campanha com 2 versões do texto, botões e "Não tenho interesse"', r.j);
const promo = r.j.campaign;

console.log('Respostas chegando pelo webhook');
const refs = (await call(A, 'POST', `/_test/campaigns/${promo.id}/simulate-sent`, { status: 'running' })).j.refs;
const ref = Object.fromEntries(refs.map(x => [x.phone, x.ref]));
check(refs.length === 3, 'simulou o envio pros 3 contatos');
check(await webhook('message', { id: 'IN1', chat: '5591988887777@s.whatsapp.net', fromMe: false, type: 'text', text: 'oi' }, 'segredo-errado') === 401, 'assinatura errada é recusada (401)');
check(await webhook('message', { id: 'IN1', chat: '5591988887777@s.whatsapp.net', chatPhone: '5591988887777', pushName: 'Maria', fromMe: false, type: 'text', text: 'Quero saber mais', timestamp: Date.now() }) === 200, 'resposta da Maria aceita');
await webhook('message', { id: 'IN1', chat: '5591988887777@s.whatsapp.net', chatPhone: '5591988887777', fromMe: false, type: 'text', text: 'Quero saber mais', timestamp: Date.now() });
await webhook('message', { id: 'G1', chat: '120363@g.us', isGroup: true, fromMe: false, type: 'text', text: 'grupo' });

let lista = (await call(A, 'GET', '/conversations')).j;
check(lista.total === 1 && lista.conversations[0].name === 'Maria Silva' && lista.conversations[0].unread === 1, 'Conversas mostra só quem respondeu (Maria, 1 não lida, sem duplicar, sem grupo)', lista);
const todas = (await call(A, 'GET', '/conversations?filter=todas')).j;
check(todas.total === 3, 'filtro "todas" mostra as 3 conversas da campanha', todas.total);
check((await call(A, 'GET', '/conversations/unread')).j.unread === 1, 'contador de não lidas = 1');
const convMaria = lista.conversations[0];
const msgs = (await call(A, 'GET', `/conversations/${convMaria.id}/messages`)).j.messages;
check(msgs.length === 2 && msgs[0].fromMe && msgs[1].text === 'Quero saber mais', 'histórico tem a mensagem da campanha e a resposta, em ordem', msgs);
const det = (await call(A, 'GET', `/conversations/${convMaria.id}`)).j.conversation;
check(det.campaign?.name === promo.name && det.contactId, 'conversa mostra a campanha e o contato', det);

console.log('Entregue / lida');
await webhook('receipt', { chat: '5591988887777@s.whatsapp.net', type: '', ids: [ref['5591988887777']] });
await webhook('receipt', { chat: '5591988887777@s.whatsapp.net', type: 'read', ids: [ref['5591988887777']] });
await webhook('receipt', { chat: '5521966665555@s.whatsapp.net', type: '', ids: [ref['5521966665555']] });
let camp = (await call(A, 'GET', `/campaigns/${promo.id}`)).j.campaign;
check(camp.stats.delivered === 2 && camp.stats.read === 1 && camp.stats.replied === 1, 'relatório: 2 entregues, 1 lida, 1 respondeu', camp.stats);
const msgs2 = (await call(A, 'GET', `/conversations/${convMaria.id}/messages`)).j.messages;
check(msgs2[0].status === 'read', 'mensagem da campanha fica com tique azul (lida)', msgs2[0]);
const resp = (await call(A, 'GET', `/campaigns/${promo.id}/targets?status=replied`)).j;
check(resp.total === 1 && resp.targets[0].reply === 'Quero saber mais' && resp.targets[0].conversationId === convMaria.id, 'filtro "Responderam" com o texto e o link da conversa', resp);

console.log('Descadastro');
await webhook('message', { id: 'IN2', chat: '5511977776666@s.whatsapp.net', chatPhone: '5511977776666', fromMe: false, type: 'text', text: 'Não tenho interesse', timestamp: Date.now() });
camp = (await call(A, 'GET', `/campaigns/${promo.id}`)).j.campaign;
check(camp.stats.optedOut === 1, 'tocar em "Não tenho interesse" descadastra (relatório)', camp.stats);
const sum = (await call(A, 'GET', '/contacts/summary')).j;
check(sum.optOut === 1, 'contato João fica descadastrado', sum);
const filtro = (await call(A, 'GET', '/contacts?situacao=optout')).j;
check(filtro.total === 1 && filtro.contacts[0].optOut === true, 'filtro de contatos "descadastrados"');
await webhook('message', { id: 'IN3', chat: '5521999990000@s.whatsapp.net', chatPhone: '5521999990000', fromMe: false, type: 'text', text: 'SAIR', timestamp: Date.now() });
check((await call(A, 'GET', '/contacts/summary')).j.optOut === 2, 'mandar SAIR também descadastra (cria o contato bloqueado)');
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Depois', messageType: 'text', text: 'Oi' });
check(r.s === 201 && r.j.total === 2 && r.j.excluded.optOut === 2, 'campanha nova pula os descadastrados', r.j);
const depois = r.j.campaign;

console.log('Enquete');
const refsE = (await call(A, 'POST', `/_test/campaigns/${enquete.id}/simulate-sent`)).j.refs;
await webhook('poll_vote', { pollMessageId: refsE.find(x => x.phone === '5521966665555').ref, voterPhone: '5521966665555', chat: '5521966665555@s.whatsapp.net', selectedNames: ['Tarde'], timestamp: Date.now() });
const votos = (await call(A, 'GET', `/campaigns/${enquete.id}/targets?status=replied`)).j;
check(votos.total === 1 && votos.targets[0].reply === '📊 Votou: Tarde', 'voto na enquete vai pro relatório', votos);

console.log('Saúde do número');
await call(A, 'POST', `/_test/campaigns/${depois.id}/hold-running`);
await webhook('message_capping', { capping: { capping_status: 'CAPPED', remaining: 0, total_quota: 50 } });
let cx = (await call(A, 'GET', '/connections')).j.connections[0];
check(cx.health.capping === 'CAPPED' && cx.health.cappingRemaining === 0, 'limite de conversas novas aparece na conexão', cx.health);
camp = (await call(A, 'GET', `/campaigns/${depois.id}`)).j.campaign;
check(camp.status === 'paused' && /limite/.test(camp.pauseReason), 'campanha rodando pausa quando o limite estoura', camp);
await webhook('restriction', { active: true, ends_at: Date.now() + 3600_000 });
cx = (await call(A, 'GET', '/connections')).j.connections[0];
check(cx.health.restriction === true && !!cx.health.restrictionEndsAt, 'restrição do WhatsApp aparece na conexão', cx.health);
await webhook('restriction', { active: false });
cx = (await call(A, 'GET', '/connections')).j.connections[0];
check(cx.health.restriction === false, 'restrição some quando acaba');

console.log('Responder e ler');
const resp2 = await call(A, 'POST', `/conversations/${convMaria.id}/messages`, { text: 'Oi Maria!' });
check(resp2.s === 400 && /desconectado/.test(resp2.j.error), 'responder com o número desconectado avisa', resp2.j);
check((await call(A, 'POST', `/conversations/${convMaria.id}/messages`, { text: '  ' })).s === 400, 'não manda mensagem vazia');
await call(A, 'POST', `/conversations/${convMaria.id}/read`);
check((await call(A, 'GET', `/conversations/${convMaria.id}`)).j.conversation.unread === 0, 'abrir a conversa zera as não lidas');
await call(A, 'POST', `/conversations/${convMaria.id}/optout`, { optOut: true });
check((await call(A, 'GET', `/conversations/${convMaria.id}`)).j.conversation.optOut === true, 'bloquear envios pela conversa');
await call(A, 'POST', `/conversations/${convMaria.id}/optout`, { optOut: false });
check((await call(A, 'GET', `/conversations/${convMaria.id}`)).j.conversation.optOut === false, 'liberar envios de novo');
const busca = (await call(A, 'GET', '/conversations?filter=todas&q=ana')).j;
check(busca.total === 1, 'busca de conversa por nome');
const dash = (await call(A, 'GET', '/dashboard')).j;
check(dash.respostasHoje >= 2 && typeof dash.naoLidas === 'number', 'painel traz respostas de hoje', dash);

console.log('Validação de números');
const val = await call(A, 'POST', '/contacts/validate', {});
check(val.s === 400 && /Conecte/.test(val.j.error), 'validar exige número conectado', val.j);

console.log('Isolamento');
const outra = await call(S, 'POST', '/admin/tenants', { name: 'Outra ' + sufixo, adminName: 'Outro', adminEmail: `outro2-${sufixo}@teste.local`, adminPassword: 'senha123' });
const O = (await call(null, 'POST', '/auth/login', { email: `outro2-${sufixo}@teste.local`, password: 'senha123' })).j.token;
check((await call(O, 'GET', `/conversations/${convMaria.id}`)).s === 404, 'outra empresa não vê a conversa');
check((await call(O, 'GET', '/conversations?filter=todas')).j.total === 0, 'outra empresa não vê nenhuma conversa');

console.log('Limpeza');
for (const id of [promo.id, enquete.id, depois.id]) await call(A, 'POST', `/campaigns/${id}/cancel`);
await call(A, 'DELETE', `/connections/${conn.id}`);
for (const t of [tid, outra.j.tenant.id]) { await call(S, 'PATCH', `/admin/tenants/${t}`, { active: false }); await call(S, 'DELETE', `/admin/tenants/${t}`) }

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
