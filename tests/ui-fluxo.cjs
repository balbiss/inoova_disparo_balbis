// Teste do painel no navegador (Chrome instalado + playwright-core).
// Uso: PW=<caminho do playwright-core> node tests/ui-fluxo.cjs [http://localhost:5195] [pasta-dos-prints]
const { chromium } = require(process.env.PW || 'playwright-core');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5195';
const PRINTS = process.argv[3] || path.join(__dirname, 'prints');
fs.mkdirSync(PRINTS, { recursive: true });
let ok = 0, falhas = 0;
const check = (c, nome) => { if (c) { ok++; console.log('  ✓', nome) } else { falhas++; console.log('  ✗', nome) } };
const sufixo = Date.now().toString(36);
const emailAdmin = `ui-${sufixo}@teste.local`;

async function semRolagemLateral(page, nome) {
  const r = await page.evaluate(() => {
    const largura = document.documentElement.clientWidth;
    const fora = [...document.querySelectorAll('body *')].filter(el => {
      const b = el.getBoundingClientRect();
      if (!b.width || getComputedStyle(el).position === 'fixed') return false;
      let p = el.parentElement;
      while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) return false; p = p.parentElement }
      return b.right > largura + 1;
    }).slice(0, 3).map(el => el.tagName + '.' + (el.className || '') + ' "' + (el.textContent || '').slice(0, 30) + '"');
    return { rola: document.documentElement.scrollWidth > largura + 1, fora };
  });
  check(!r.rola && !r.fora.length, `${nome}: nada sai da tela ${r.fora.length ? JSON.stringify(r.fora) : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errosConsole = [];
  page.on('pageerror', e => errosConsole.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|401|400/.test(m.text())) errosConsole.push(m.text()) });
  const shot = n => page.screenshot({ path: path.join(PRINTS, n + '.png'), fullPage: true });

  console.log('Login');
  await page.goto(BASE + '/login');
  await shot('01-login');
  await page.fill('input[type=email]', 'admin@teste.local');
  await page.fill('input[type=password]', 'errada');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  check((await page.textContent('[role=alert]')).includes('incorretos'), 'senha errada mostra aviso');
  await page.fill('input[type=password]', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL('**/empresas');
  check(true, 'superadmin cai em Empresas');

  console.log('Empresas');
  await page.click('text=Nova empresa');
  await page.fill('input >> nth=0', 'Loja UI ' + sufixo);
  const modal = page.locator('[role=dialog]');
  await modal.locator('label:has-text("Nome") input').nth(1).fill('Dona da Loja');
  await modal.locator('input[type=email]').fill(emailAdmin);
  await modal.locator('label:has-text("Senha inicial") input').fill('senha123');
  await shot('02-nova-empresa');
  await modal.locator('button:has-text("Salvar")').click();
  await page.waitForSelector(`text=Loja UI ${sufixo}`);
  check(await page.isVisible(`text=${emailAdmin}`), 'empresa aparece na lista com o e-mail do admin');
  await shot('03-empresas');

  console.log('Admin da empresa');
  await page.click('header button:has-text("Administrador")');
  await page.click('text=Sair');
  await page.waitForURL('**/login');
  await page.fill('input[type=email]', emailAdmin);
  await page.fill('input[type=password]', 'senha123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/painel');
  await page.waitForSelector('text=Números conectados');
  check(await page.isVisible('text=ainda não conectou'), 'painel avisa que não tem número conectado');
  await shot('04-painel-vazio');

  console.log('Contatos');
  await page.click('nav >> text=Contatos');
  await page.waitForSelector('text=Sua lista está vazia');
  await page.click('button:has-text("Categorias")');
  await page.fill('[role=dialog] input', 'Clientes');
  await page.click('[role=dialog] button:has(svg.lucide-plus)');
  await page.waitForSelector('[role=dialog] >> text=0 contato(s)');
  check(true, 'cria categoria');
  await page.click('[role=dialog] button[aria-label=Fechar]');
  await page.click('button:has-text("Importar")');
  await page.click('[role=dialog] button:has-text("Colar lista")');
  await page.fill('[role=dialog] textarea', 'Maria Silva; 91 98888-7777\nJoão Souza - 11 97777-6666\n21966665555\nlixo');
  await page.selectOption('[role=dialog] select', { label: 'Clientes' });
  await shot('05-importar');
  await page.click('[role=dialog] button:has-text("Importar 4")');
  await page.waitForSelector('td:has-text("Maria Silva")');
  check(await page.isVisible('text=(91) 98888-7777'), 'importa lista colada e formata o telefone');
  check(await page.locator('tbody tr').count() === 3, '3 contatos válidos (1 inválido ignorado)');
  await page.fill('input[placeholder*="Buscar"]', 'joão');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  check(true, 'busca por nome');
  await page.fill('input[placeholder*="Buscar"]', '');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
  await shot('06-contatos');

  console.log('Conexões');
  await page.click('nav >> text=Conexões');
  await page.click('button:has-text("Adicionar número") >> nth=0');
  await page.fill('[role=dialog] input', 'Comercial');
  await page.click('[role=dialog] button:has-text("Continuar")');
  await page.waitForSelector('[role=dialog] img[alt*="QR"]', { timeout: 30000 }).then(() => check(true, 'QR Code aparece (AstraCalls real)')).catch(() => check(false, 'QR Code aparece (AstraCalls real)'));
  await shot('07-qr');
  await page.click('[role=dialog] button:has-text("Código pelo número")');
  await shot('08-codigo');
  await page.click('[role=dialog] button[aria-label=Fechar]');
  await page.waitForSelector('text=Desconectado');
  await shot('09-conexoes');

  console.log('Nova campanha');
  await page.click('nav >> text=Campanhas');
  await page.click('a:has-text("Criar a primeira")');
  await page.waitForSelector('text=Tipo de campanha');
  await page.fill('input[placeholder*="Promoção"]', 'Promo UI');
  await page.fill('textarea', '{Oi|Olá} {primeiro_nome}! *Promoção* só hoje.');
  check(await page.isVisible('b:has-text("Promoção")'), 'prévia mostra negrito do WhatsApp');
  check(await page.isVisible('text=Oi Maria!'), 'prévia troca as variáveis');
  check(await page.isVisible('text=Não tenho interesse'), 'botão "Não tenho interesse" vem ligado e aparece na prévia');
  await page.click('button:has-text("Outra versão")');
  await page.fill('textarea', 'Versão B pra {nome}');
  check(await page.isVisible('text=Versão B pra Maria Silva'), 'segunda versão do texto (anti-spam)');
  await page.click('button:text-is("A")');
  await page.click('button:has-text("Botão")');
  await page.selectOption('select >> nth=0', 'cta_url');
  await page.fill('input[placeholder="Texto do botão"]', 'Ver site');
  await page.fill('input[placeholder="https://seusite.com.br"]', 'https://inoovaweb.com.br');
  check(await page.isVisible('text=Ver site'), 'botão de link na prévia');
  await page.click('button:has-text("Ajustar")');
  check(await page.isVisible('text=Intervalo entre envios'), 'segurança anti-bloqueio pode ser ajustada');
  await shot('10-nova-campanha');
  await page.click('button:has-text("Rascunho")');
  await page.click('button:has-text("Salvar rascunho")');
  await page.waitForURL(/\/campanhas\/\d+$/);
  await page.waitForSelector('td:has-text("Maria Silva")');
  check(await page.locator('td:has-text("Na fila")').count() === 3, 'detalhe mostra os 3 contatos na fila');
  await page.click('button:has-text("Iniciar")');
  check(await page.waitForSelector('.swal2-toast:has-text("desconectado")', { timeout: 8000 }).then(() => true).catch(() => false), 'não inicia com número desconectado e explica o motivo');
  await shot('11-campanha-detalhe');
  const campanhaUrl = page.url();

  // agendar pela tela de detalhe
  await page.click('button:has-text("Agendar")');
  await page.waitForSelector('#quando');
  await page.click('.swal2-confirm');
  await page.waitForSelector('text=Agendada pra');
  check(await page.isVisible('button:has-text("Mudar horário")'), 'campanha agendada (com "Iniciar agora" e "Mudar horário")');
  await shot('11b-agendada');

  console.log('Conversas (resposta simulada pelo webhook)');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const API = BASE.replace(':5195', ':3020') + '/api';
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  const campId = campanhaUrl.split('/').pop();
  await fetch(API + '/campaigns/' + campId + '/cancel', { method: 'POST', headers: H });
  const conns = await (await fetch(API + '/connections', { headers: H })).json();
  const sec = await (await fetch(API + '/_test/connections/' + conns.connections[0].id + '/secret', { headers: H })).json();
  const nova = await (await fetch(API + '/campaigns', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Simulada', kind: 'message', connectionId: conns.connections[0].id, messageType: 'text', text: 'Oi {primeiro_nome}!', audience: { all: true } }) })).json();
  await fetch(API + '/_test/campaigns/' + nova.campaign.id + '/simulate-sent', { method: 'POST', headers: H, body: '{}' });
  const crypto = require('crypto');
  const corpo = JSON.stringify({ session: sec.sessionId, event: 'message', timestamp: Date.now(), data: { id: 'UI-' + Date.now(), chat: '5591988887777@s.whatsapp.net', chatPhone: '5591988887777', fromMe: false, type: 'text', text: 'Tenho interesse! Qual o preço?', timestamp: Date.now() } });
  const sig = 'sha256=' + crypto.createHmac('sha256', sec.secret).update(corpo).digest('hex');
  await fetch(API + '/webhooks/astra/' + conns.connections[0].id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig }, body: corpo });
  await page.goto(BASE + '/painel');
  await page.waitForSelector('nav >> text=Conversas');
  await page.waitForFunction(() => [...document.querySelectorAll('nav a')].some(a => a.textContent.includes('Conversas') && /\d/.test(a.textContent)), null, { timeout: 15000 }).then(() => check(true, 'menu mostra contador de não lidas')).catch(() => check(false, 'menu mostra contador de não lidas'));
  await page.click('nav >> text=Conversas');
  await page.waitForSelector('text=Maria Silva');
  await shot('14-conversas-lista');
  await page.click('aside button:has-text("Maria Silva")');
  await page.waitForSelector('text=Tenho interesse! Qual o preço?');
  check(await page.locator('section div:text-is("Oi Maria!")').count() > 0, 'chat mostra a mensagem da campanha e a resposta');
  await page.fill('textarea[placeholder="Digite uma mensagem"]', 'Oi Maria, já te passo!');
  await page.keyboard.press('Enter');
  check(await page.waitForSelector('.swal2-toast:has-text("desconectado")', { timeout: 8000 }).then(() => true).catch(() => false), 'responder com número desconectado avisa');
  await shot('15-conversa');
  await page.goto(BASE + '/campanhas/' + nova.campaign.id);
  await page.waitForSelector('text=Tenho interesse! Qual o preço?');
  check(true, 'relatório da campanha mostra a resposta com link pra conversa');
  await shot('16-relatorio-resposta');

  // ligação: tela muda e exige arquivo
  await page.goto(BASE + '/campanhas/nova');
  await page.click('button:has-text("Ligação")');
  check(await page.isVisible('text=Escolher o áudio da ligação'), 'ligação pede o áudio');
  await page.setInputFiles('input[type=file]', { name: 'recado.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]) });
  await page.waitForSelector('text=recado.mp3');
  check(true, 'envia o áudio');
  await shot('12-nova-ligacao');

  console.log('Equipe');
  await page.click('nav >> text=Equipe');
  await page.click('button:has-text("Novo usuário")');
  const m2 = page.locator('[role=dialog]');
  await m2.locator('input').nth(0).fill('Atendente');
  await m2.locator('input[type=email]').fill(`at-${sufixo}@teste.local`);
  await m2.locator('input[type=password]').fill('senha123');
  await m2.locator('button:has-text("Salvar")').click();
  await page.waitForSelector('text=Atendente');
  check(true, 'cria usuário da equipe');
  await shot('13-equipe');

  console.log('Superadmin: Segurança');
  await page.click('header button:has-text("Administrador")');
  await page.click('text=Sair');
  await page.waitForURL('**/login');
  await page.fill('input[type=email]', 'admin@teste.local');
  await page.fill('input[type=password]', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL('**/empresas');
  await page.click('nav >> text=Segurança');
  await page.waitForSelector('text=Piso pra mensagem');
  check(true, 'tela de segurança do superadmin');
  await shot('17-seguranca');
  await page.goto(BASE + '/login');
  await page.evaluate(() => localStorage.clear());
  await page.fill('input[type=email]', emailAdmin);
  await page.fill('input[type=password]', 'senha123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/painel');

  console.log('Celular (390px)');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [rota, nome] of [['/painel', 'painel'], ['/campanhas', 'campanhas'], ['/conversas', 'conversas'], ['/contatos', 'contatos'], ['/conexoes', 'conexoes'], ['/campanhas/nova', 'nova-campanha'], ['/equipe', 'equipe']]) {
    await page.goto(BASE + rota);
    await page.waitForTimeout(900);
    await semRolagemLateral(page, nome + ' 390px');
    await page.screenshot({ path: path.join(PRINTS, `m-${nome}.png`), fullPage: true });
  }
  await page.click('button[aria-label="Abrir menu"]');
  await page.waitForSelector('button[aria-label="Fechar menu"]');
  await page.screenshot({ path: path.join(PRINTS, 'm-menu.png') });
  check(true, 'menu do celular abre');
  for (const w of [1024, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const rota of ['/painel', '/campanhas/nova', '/contatos', '/conversas', '/conexoes']) { await page.goto(BASE + rota); await page.waitForTimeout(600); await semRolagemLateral(page, `${rota} ${w}px`) }
  }

  check(errosConsole.length === 0, 'sem erro no console ' + (errosConsole.length ? JSON.stringify(errosConsole.slice(0, 3)) : ''));
  await browser.close();
  console.log(`\n${ok} ok, ${falhas} falha(s) — prints em ${PRINTS}`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
