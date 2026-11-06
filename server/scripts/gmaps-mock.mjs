// gosom/google-maps-scraper SIMULADO (só pra desenvolvimento e testes): mesma API do modo web.
// Uso: node scripts/gmaps-mock.mjs  (porta 8099) e GMAPS_URL=http://localhost:8099 no server/.env
import http from 'node:http';
import crypto from 'node:crypto';

const jobs = new Map();
const CSV = [
  'input_id,link,title,category,address,open_hours,popular_times,website,phone,plus_code,review_count,review_rating,reviews_per_rating,latitude,longitude,cid,status,descriptions,reviews_link,thumbnail,timezone,price_range,data_id,images,reservations,order_online,menu,owner,complete_address,about,user_reviews,emails',
  '1,https://maps.google.com/?cid=1,Móveis Bela Casa,Loja de móveis,"Rod. BR-316, 120 - Centro",,,https://belacasa.com.br,(91) 98123-4567,,214,4.7,,,,1,,,,,,,,,,,,,"Rod. BR-316, 120 - Centro, Ananindeua - PA",,,contato@belacasa.com.br',
  '1,https://maps.google.com/?cid=2,"Estofados ""Conforto"" & Cia",Loja de estofados,Av. Independência 55,,,,+55 91 3255-1020,,48,4.2,,,,2,,,,,,,,,,,,,"Av. Independência 55, Ananindeua - PA",,,',
  '1,https://maps.google.com/?cid=3,Casa & Decoração,Loja de decoração,Tv. WE 12,,,,,,9,3.9,,,,3,,,,,,,,,,,,,"Tv. WE 12,\nCidade Nova, Ananindeua - PA",,,',
  '1,https://maps.google.com/?cid=4,Móveis Bela Casa (filial),Loja de móveis,Rua 2,,,,(91) 98123-4567,,5,5,,,,4,,,,,,,,,,,,,"Rua 2, Ananindeua - PA",,,',
  '1,https://maps.google.com/?cid=5,Planejados Norte,Móveis planejados,Av. Mário Covas 900,,,https://planejadosnorte.com,91 99988-7766,,120,4.9,,,,5,,,,,,,,,,,,,"Av. Mário Covas 900, Ananindeua - PA",,,',
].join('\r\n');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) };
  if (req.method === 'POST' && url.pathname === '/api/v1/jobs') {
    let b = '';
    req.on('data', d => (b += d)).on('end', () => {
      const d = JSON.parse(b || '{}');
      if (!d.keywords?.length || !d.lang || !d.depth || !d.max_time) return json(422, { code: 422, message: 'missing fields' });
      const id = crypto.randomUUID();
      const falhar = String(d.keywords[0]).includes('FALHAR');
      jobs.set(id, { ID: id, Name: d.name, Status: 'pending', Data: d, criado: Date.now(), falhar });
      json(201, { id });
    });
    return;
  }
  const m = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)(\/download)?$/);
  if (m) {
    const j = jobs.get(m[1]);
    if (!j) return json(404, { code: 404, message: 'Not Found' });
    const passou = Date.now() - j.criado;
    j.Status = j.falhar && passou > 2000 ? 'failed' : passou > 4000 ? 'ok' : passou > 1000 ? 'working' : 'pending';
    if (req.method === 'DELETE') { jobs.delete(m[1]); res.writeHead(200); return res.end() }
    if (m[2]) { res.writeHead(200, { 'Content-Type': 'text/csv' }); return res.end(CSV) }
    const { criado: _c, falhar: _f, ...pub } = j;
    return json(200, pub);
  }
  json(404, { code: 404, message: 'Not Found' });
}).listen(Number(process.env.PORT || 8099), () => console.log('[gmaps-mock] ouvindo na porta', process.env.PORT || 8099));
