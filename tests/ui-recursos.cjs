// Teste no navegador dos recursos novos, simulando o AstraCalls (grupos, participantes, ligação chegando).
// Uso: PW=<playwright-core> node tests/ui-recursos.cjs [http://localhost:5195] [pasta-dos-prints]
const { chromium } = require(process.env.PW || 'playwright-core');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const WEB = process.argv[2] || 'http://localhost:5195';
const API = WEB.replace(':5195', ':3020') + '/api';
const PRINTS = process.argv[3] || path.join(__dirname, 'prints');
fs.mkdirSync(PRINTS, { recursive: true });
let ok = 0, falhas = 0;
const check = (c, nome) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome) } };
const j = async (m, p, t, b) => (await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json().catch(() => ({}));
const sim = (sel, page, ms = 6000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);

(async () => {
  const suf = Date.now().toString(36);
  const SA = (await j('POST', '/auth/login', null, { email: 'admin@teste.local', password: '123456' })).token;
  const ten = (await j('POST', '/admin/tenants', SA, { name: 'Loja Recursos', maxConnections: 3, adminName: 'Ana Souza', adminEmail: `uirec-${suf}@teste.local`, adminPassword: 'senha123' })).tenant;
  const login = await j('POST', '/auth/login', null, { email: `uirec-${suf}@teste.local`, password: 'senha123' });
  const A = login.token;
  await j('POST', '/contacts/import', A, { rows: [{ name: 'Maria Silva', phone: '91988887777' }, { name: 'João Souza', phone: '11977776666' }] });
  const c1 = (await j('POST', '/connections', A, { name: 'Chip 1' })).connection;
  const c2 = (await j('POST', '/connections', A, { name: 'Chip 2' })).connection;
  const sec = await j('GET', `/_test/connections/${c1.id}/secret`, A);
  const camp = (await j('POST', '/campaigns', A, { name: 'Promoção', kind: 'message', connectionId: c1.id, messageType: 'text', text: 'Oi {primeiro_nome}!', audience: { all: true } })).campaign;
  await j('POST', `/_test/campaigns/${camp.id}/simulate-sent`, A, {});
  const corpo = JSON.stringify({ session: sec.sessionId, event: 'message', timestamp: Date.now(), data: { id: 'U' + Date.now(), chat: '5591988887777@s.whatsapp.net', chatPhone: '5591988887777', fromMe: false, type: 'text', text: 'Quanto custa?', timestamp: Date.now() } });
  await fetch(`${API}/webhooks/astra/${c1.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'sha256=' + crypto.createHmac('sha256', sec.secret).update(corpo).digest('hex') }, body: corpo });

  const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errosConsole = [];
  page.on('pageerror', e => errosConsole.push(e.message));
  // AstraCalls simulado: grupos, participantes, extração
  const GRUPOS = [{ jid: '120363000000000001@g.us', name: 'Clientes VIP', participants: 3, withPhone: 2, announce: false }, { jid: '120363000000000002@g.us', name: 'Turma Novembro', participants: 2, withPhone: 2, announce: false }];
  await page.route('**/api/connections/*/groups', r => r.fulfill({ json: { groups: GRUPOS } }));
  await page.route('**/api/connections/*/groups/*/participants', r => r.fulfill({ json: { group: GRUPOS[0], participants: [{ name: 'Carla Dias', phone: '5521966665555', admin: true, eu: false }, { name: 'Pedro Lima', phone: '5531955554444', admin: false, eu: false }, { name: '', phone: '', admin: false, eu: false }] } }));
  await page.route('**/api/contacts/import-groups', r => r.fulfill({ json: { created: 2, updated: 0, invalid: 0, duplicatedInFile: 0, hidden: 1, participants: 2 } }));
  await page.goto(WEB + '/login');
  await page.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('usuario', JSON.stringify(u)) }, [A, login.user]);

  console.log('Grupos (extrair contatos)');
  await page.goto(WEB + '/grupos');
  check(await sim('text=Clientes VIP', page), 'lista os grupos do número');
  await page.click('text=Clientes VIP');
  check(await sim('text=Carla Dias', page), 'mostra os participantes do grupo');
  check(await page.isVisible('text=Número escondido no grupo'), 'avisa participante com número escondido');
  await page.click('input[aria-label="Marcar Clientes VIP"]');
  await page.click('input[aria-label="Marcar Turma Novembro"]');
  check(await page.isVisible('text=grupo(s) marcado(s)'), 'barra de ações com os grupos marcados');
  await page.screenshot({ path: path.join(PRINTS, 'r1-grupos.png') });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('button:has-text("Baixar planilha")')]);
  check(!!dl && /\.csv$/.test(dl.suggestedFilename()), 'baixa a planilha dos participantes');
  await page.click('button:has-text("Salvar nos contatos")');
  check(await sim('.swal2-toast:has-text("contato(s) novo")', page), 'salva os participantes nos contatos');

  console.log('Conversas: etiquetas, respostas rápidas, ligar');
  await page.goto(WEB + '/conversas');
  await page.click('aside button:has-text("Maria Silva")');
  await page.waitForSelector('text=Quanto custa?');
  await page.click('button[title="Etiquetas"]');
  await page.click('button:has-text("Interessado")');
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  check(await sim('header >> text=Interessado', page), 'marca a conversa como Interessado');
  await page.click('button[aria-label="Respostas rápidas"]');
  await page.fill('input[placeholder="atalho (ex.: preco)"]', 'preco');
  await page.fill('textarea[placeholder*="O valor é"]', 'Oi {primeiro_nome}! Custa R$ 99,90.');
  await page.click('button:has-text("Salvar resposta")');
  check(await sim('text=/preco', page), 'cria resposta rápida /preco');
  await page.click('[role=dialog] button[aria-label="Fechar"]');
  await page.fill('textarea[placeholder*="Digite uma mensagem"]', '/pre');
  check(await sim('text=Respostas rápidas · Enter pra usar', page), 'digitar / mostra as respostas rápidas');
  await page.keyboard.press('Enter');
  check((await page.inputValue('textarea[placeholder*="Digite uma mensagem"]')) === 'Oi Maria! Custa R$ 99,90.', 'Enter aplica a resposta com o nome da pessoa');
  await page.screenshot({ path: path.join(PRINTS, 'r2-conversa.png') });
  await page.click('button[title="Ligar pelo WhatsApp"]');
  check(await sim('.swal2-toast:has-text("desconectado")', page), 'ligar com número desconectado avisa');
  await page.goto(WEB + '/conversas');
  await page.selectOption('select[aria-label="Filtrar por etiqueta"]', { label: 'Interessado (1)' });
  check(await sim('aside button:has-text("Maria Silva")', page), 'filtro por etiqueta');

  console.log('Ligação chegando (simulada)');
  await page.route('**/api/calls/active', r => r.fulfill({ json: { calls: [{ callId: 'abc', direcao: 'entrada', telefone: '5591988887777', nome: 'Maria Silva', conversationId: null, connName: 'Chip 1', status: 'tocando', userId: null, userNome: '', inicio: Date.now(), atendidaEm: null }] } }));
  check(await sim('[role=alertdialog] >> text=Maria Silva', page), 'mostra a ligação chegando com Atender/Recusar');
  await page.screenshot({ path: path.join(PRINTS, 'r3-ligacao.png') });
  await page.unroute('**/api/calls/active');
  await page.route('**/api/calls/abc/reject', r => r.fulfill({ json: { ok: true } }));
  await page.click('button:has-text("Recusar")');

  console.log('Reenviar / duplicar');
  await page.goto(WEB + '/campanhas/' + camp.id);
  await page.click('button:has-text("Reenviar / Duplicar")');
  check(await sim('text=Quem não respondeu', page), 'janela de reenviar com as opções');
  await page.screenshot({ path: path.join(PRINTS, 'r4-reenviar.png') });
  await page.click('[role=dialog] button:has-text("Criar campanha")');
  await page.waitForURL(u => !u.toString().endsWith('/campanhas/' + camp.id), { timeout: 8000 }).catch(() => {});
  check(/\/campanhas\/\d+$/.test(page.url()) && !page.url().endsWith('/campanhas/' + camp.id), 'cria a campanha nova e abre ela');

  console.log('Nova campanha: rodízio, grupos, teste');
  await page.goto(WEB + '/campanhas/nova');
  await page.click('button:has-text("Continuar")');
  await page.fill('textarea', 'Oi {primeiro_nome}!');
  await page.click('button:has-text("Continuar")');
  check(await sim('text=Usar mais números ao mesmo tempo', page), 'opção de rodízio de números');
  await page.click('button:has-text("Chip 2")');
  await page.click('button:has-text("Grupos do WhatsApp")');
  check(await sim('label:has-text("Turma Novembro")', page), 'lista os grupos pra disparar dentro');
  await page.click('label:has-text("Turma Novembro") input');
  check(await page.isVisible('text=Marcar todos os participantes'), 'opção de marcar todos (@todos)');
  await page.screenshot({ path: path.join(PRINTS, 'r5-nova-grupos.png'), fullPage: true });
  await page.click('button:has-text("Continuar")');
  await page.click('button:has-text("Continuar")');
  check(await sim('text=1 grupo(s): Turma Novembro', page), 'resumo mostra o grupo e os 2 números');
  await page.fill('input[placeholder="Seu WhatsApp com DDD"]', '91988887777');
  await page.click('button:has-text("Enviar teste pra mim")');
  check(await sim('.swal2-toast:has-text("desconectado")', page), 'enviar teste com número desconectado avisa');
  await page.screenshot({ path: path.join(PRINTS, 'r6-revisar.png'), fullPage: true });

  console.log('Celular');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const rota of ['/grupos', '/conversas']) {
    await page.goto(WEB + rota); await page.waitForTimeout(800);
    const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!rola, `${rota} 390px sem rolagem lateral`);
  }
  await page.goto(WEB + '/grupos'); await page.waitForSelector('text=Clientes VIP');
  await page.screenshot({ path: path.join(PRINTS, 'r7-grupos-celular.png'), fullPage: true });

  check(errosConsole.length === 0, 'sem erro no console ' + (errosConsole.length ? JSON.stringify(errosConsole.slice(0, 2)) : ''));
  await browser.close();
  for (const c of (await j('GET', '/campaigns', A)).campaigns || []) await j('POST', `/campaigns/${c.id}/cancel`, A);
  for (const c of [c1, c2]) await j('DELETE', `/connections/${c.id}`, A);
  await j('PATCH', `/admin/tenants/${ten.id}`, SA, { active: false }); await j('DELETE', `/admin/tenants/${ten.id}`, SA);
  console.log(`\n${ok} ok, ${falhas} falha(s) — prints em ${PRINTS}`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
