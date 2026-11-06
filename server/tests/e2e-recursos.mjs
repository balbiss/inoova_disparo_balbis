// Recursos: reenviar/duplicar, enviar teste, respostas rápidas, etiquetas, grupos, rodízio de números, ligação.
// Precisa da API com ENABLE_TEST_ROUTES=1. Uso: node tests/e2e-recursos.mjs [http://localhost:3020]
import crypto from 'node:crypto';
const BASE = (process.argv[2] || 'http://localhost:3020') + '/api';
let ok = 0, falhas = 0;
const check = (c, nome, extra) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } };
const espera = ms => new Promise(r => setTimeout(r, ms));
async function call(token, metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j };
}
const sufixo = Date.now().toString(36);
const S = (await call(null, 'POST', '/auth/login', { email: 'admin@teste.local', password: '123456' })).j.token;
const nova = await call(S, 'POST', '/admin/tenants', { name: 'Recursos ' + sufixo, maxConnections: 3, adminName: 'Dono', adminEmail: `rec-${sufixo}@teste.local`, adminPassword: 'senha123' });
const A = (await call(null, 'POST', '/auth/login', { email: `rec-${sufixo}@teste.local`, password: 'senha123' })).j.token;
await call(A, 'POST', '/contacts/import', { rows: [{ name: 'Maria', phone: '91988887777' }, { name: 'João', phone: '11977776666' }, { name: 'Ana', phone: '21966665555' }] });
const c1 = (await call(A, 'POST', '/connections', { name: 'Chip 1' })).j.connection;
const c2 = (await call(A, 'POST', '/connections', { name: 'Chip 2' })).j.connection;
const seg = (await call(A, 'GET', `/_test/connections/${c1.id}/secret`)).j;
async function webhook(event, data) {
  const corpo = JSON.stringify({ session: seg.sessionId, event, timestamp: Date.now(), data });
  await fetch(BASE + `/webhooks/astra/${c1.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'sha256=' + crypto.createHmac('sha256', seg.secret).update(corpo).digest('hex') }, body: corpo });
  await espera(250);
}
const base = { kind: 'message', connectionId: c1.id, messageType: 'text', text: 'Oi {primeiro_nome}', audience: { all: true } };

console.log('Rodízio de números');
let r = await call(A, 'POST', '/campaigns', { ...base, name: 'Rodízio', connectionIds: [c1.id, c2.id] });
check(r.s === 201 && r.j.campaign.connectionIds.length === 2, 'campanha com 2 números (rodízio)', r.j);
const rod = r.j.campaign;
check((await call(A, 'POST', '/campaigns', { ...base, name: 'X', connectionIds: [999999] })).s === 400, 'não aceita número de outra empresa');

console.log('Grupos');
r = await call(A, 'POST', '/campaigns', { ...base, name: 'Grupos', mentionAll: true, audience: { groups: [{ jid: '120363000000000001@g.us', name: 'Turma VIP' }, { jid: '120363000000000002@g.us', name: 'Clientes' }] } });
check(r.s === 201 && r.j.total === 2 && r.j.campaign.mentionAll === true, 'campanha pra 2 grupos marcando todos', r.j);
const grp = r.j.campaign;
const alvosG = (await call(A, 'GET', `/campaigns/${grp.id}/targets`)).j.targets;
check(alvosG.every(t => t.isGroup && t.phone.endsWith('@g.us')), 'destinos são grupos', alvosG);
check((await call(A, 'POST', '/campaigns', { ...base, kind: 'call', name: 'L', media: null, audience: { groups: [{ jid: '1@g.us', name: 'x' }] } })).s === 400, 'ligação pra grupo é recusada');
const ig = await call(A, 'POST', '/contacts/import-groups', { connectionId: c1.id, groupJids: ['120363000000000001@g.us'] });
check(ig.s === 400 && /desconectado|grupos/.test(ig.j.error), 'extrair contatos de grupo pede número conectado', ig.j);
check((await call(A, 'GET', `/connections/${c1.id}/groups`)).s >= 400, 'listar grupos com número desconectado avisa');

console.log('Reenviar / duplicar');
const camp = (await call(A, 'POST', '/campaigns', { ...base, name: 'Promo' })).j.campaign;
const refs = (await call(A, 'POST', `/_test/campaigns/${camp.id}/simulate-sent`)).j.refs;
const ref = Object.fromEntries(refs.map(x => [x.phone, x.ref]));
await webhook('receipt', { type: 'read', ids: [ref['5591988887777'], ref['5511977776666']] });
await webhook('message', { id: 'R1', chat: '5591988887777@s.whatsapp.net', chatPhone: '5591988887777', fromMe: false, type: 'text', text: 'Quero!', timestamp: Date.now() });
r = await call(A, 'POST', `/campaigns/${camp.id}/duplicate`, { publico: 'nao_responderam', text: 'Oi {primeiro_nome}, viu nossa mensagem?' });
check(r.s === 201 && r.j.total === 2 && r.j.campaign.status === 'draft' && r.j.campaign.text.includes('viu nossa'), 'reenviar pra quem não respondeu (2) com texto novo', r.j);
r = await call(A, 'POST', `/campaigns/${camp.id}/duplicate`, { publico: 'nao_leram' });
check(r.s === 201 && r.j.total === 1, 'reenviar pra quem não leu (1)', r.j);
r = await call(A, 'POST', `/campaigns/${camp.id}/duplicate`, { publico: 'todos' });
check(r.s === 201 && r.j.total === 3 && /cópia/.test(r.j.campaign.name), 'duplicar campanha inteira', r.j);
check((await call(A, 'POST', `/campaigns/${camp.id}/duplicate`, { publico: 'falharam' })).s === 400, 'ninguém falhou: avisa');

console.log('Enviar teste pra mim');
r = await call(A, 'POST', '/campaigns/test', { ...base, phone: '91988887777' });
check(r.s === 400 && /desconectado/.test(r.j.error), 'teste com número desconectado avisa', r.j);
check((await call(A, 'POST', '/campaigns/test', { ...base, text: '', phone: '91988887777' })).s === 400, 'teste valida o conteúdo');
check((await call(A, 'POST', '/campaigns/test', { ...base, phone: '12' })).s === 400, 'teste valida o telefone');

console.log('Respostas rápidas');
r = await call(A, 'POST', '/quick-replies', { shortcut: '/Preço', text: 'O valor é R$ 99,90 😉' });
check(r.s === 201 && r.j.quickReply.shortcut === 'preco', 'cria /preco (sem acento e barra)', r.j);
check((await call(A, 'POST', '/quick-replies', { shortcut: 'preco', text: 'x' })).s === 409, 'atalho repetido = 409');
const qr = r.j.quickReply;
check((await call(A, 'PATCH', `/quick-replies/${qr.id}`, { text: 'Novo valor' })).j.quickReply.text === 'Novo valor', 'edita resposta');
check((await call(A, 'GET', '/quick-replies')).j.quickReplies.length === 1, 'lista respostas');
await call(A, 'DELETE', `/quick-replies/${qr.id}`);
check((await call(A, 'GET', '/quick-replies')).j.quickReplies.length === 0, 'apaga resposta');

console.log('Etiquetas');
let tg = (await call(A, 'GET', '/tags')).j.tags;
check(tg.length === 4 && tg[0].name === 'Interessado', 'etiquetas padrão criadas (Interessado, Negociando, Fechou, Sem interesse)', tg);
const conv = (await call(A, 'GET', '/conversations?filter=respondidas')).j.conversations[0];
r = await call(A, 'PUT', `/conversations/${conv.id}/tags`, { tagIds: [tg[0].id, tg[2].id] });
check(r.s === 200 && r.j.tagIds.length === 2, 'marca a conversa com 2 etiquetas');
check((await call(A, 'GET', `/conversations/${conv.id}`)).j.conversation.tagIds.length === 2, 'conversa mostra as etiquetas');
const filt = (await call(A, 'GET', `/conversations?filter=todas&tagId=${tg[0].id}`)).j;
check(filt.total === 1 && filt.conversations[0].tagIds.includes(tg[0].id), 'filtra conversas por etiqueta', filt);
tg = (await call(A, 'GET', '/tags')).j.tags;
check(tg[0].total === 1, 'etiqueta mostra quantas conversas tem');
const nt = await call(A, 'POST', '/tags', { name: 'VIP', color: '#7C5CFF' });
check(nt.s === 201, 'cria etiqueta nova');
await call(A, 'DELETE', `/tags/${nt.j.tag.id}`);

console.log('Ligação pelo navegador');
check((await call(A, 'GET', '/calls/active')).j.calls.length === 0, 'nenhuma ligação ativa');
r = await call(A, 'POST', '/calls/dial', { conversationId: conv.id });
check(r.s === 400 && /desconectado/.test(r.j.error), 'ligar com número desconectado avisa', r.j);
const ws = await fetch(BASE + '/calls/xyz/ws?token=errado').catch(() => null);
check(!ws || ws.status >= 400, 'áudio da ligação sem login é recusado');

console.log('Limpeza');
for (const c of (await call(A, 'GET', '/campaigns')).j.campaigns) await call(A, 'POST', `/campaigns/${c.id}/cancel`);
for (const c of (await call(A, 'GET', '/connections')).j.connections) await call(A, 'DELETE', `/connections/${c.id}`);
await call(S, 'PATCH', `/admin/tenants/${nova.j.tenant.id}`, { active: false });
await call(S, 'DELETE', `/admin/tenants/${nova.j.tenant.id}`);
console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
