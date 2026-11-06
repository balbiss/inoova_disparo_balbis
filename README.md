# InoovaDisparo

SaaS multi-empresa de disparo pelo WhatsApp usando o **AstraCalls** como motor:
campanhas de **mensagem** (texto, imagem, vídeo, áudio, documento) e de **ligação**
(liga e toca um áudio/vídeo gravado quando a pessoa atende).

- **Superadmin** (dono do SaaS): cria as empresas, define os limites (números e contatos), troca a senha do admin delas.
- **Empresa**: conecta o número por QR ou código, importa contatos (CSV ou lista colada), separa por categoria,
  cria campanhas e acompanha o relatório de cada contato (exporta CSV).

## Estrutura
- `src/`: painel (React + Vite), visual do Clara v2 com as cores do WhatsApp
- `server/`: API (Express + Drizzle + Postgres) e motor de disparo (`server/src/lib/worker.ts`)
- O AstraCalls é chamado só pelo servidor (`ASTRACALLS_URL` + `ASTRACALLS_API_KEY`); o QR e o estado dos números chegam pelo SSE `/api/events`.

## Rodar local (sem Docker)
```bash
cd server && npm install && npm run devdb   # Postgres (PGlite) na porta 55450
cd server && npm run dev                    # API na porta 3020 (precisa do server/.env)
npm install && npm run dev                  # painel em http://localhost:5195
```
`server/.env` de exemplo:
```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55450/postgres
DB_POOL_MAX=1
JWT_SECRET=troque
SUPERADMIN_EMAIL=admin@teste.local
SUPERADMIN_PASSWORD=123456
ASTRACALLS_URL=https://seu-astracalls
ASTRACALLS_API_KEY=...
```

## Testes
```bash
node server/tests/e2e-api.mjs                    # API (cria e apaga uma empresa de teste)
PW=<playwright-core> node tests/ui-fluxo.cjs     # painel no Chrome, inclusive 390px
```

## Produção
`Dockerfile` gera um container só (API + painel na porta 3020). Variáveis: `DATABASE_URL`, `JWT_SECRET`,
`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `ASTRACALLS_URL`, `ASTRACALLS_API_KEY`, `PUBLIC_URL` (webhook do AstraCalls) e `GMAPS_URL` (extrator de leads); volume em `/app/uploads`.
Stack pronta em `deploy/stack.yml` (app + Postgres + extrator gosom só na rede interna). As migrações rodam sozinhas ao subir.

## Extrator de leads
Usa o [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) (MIT) em modo web, na rede interna (ele não tem senha). Em desenvolvimento dá pra usar o simulado: `node server/scripts/gmaps-mock.mjs` + `GMAPS_URL=http://localhost:8099`. Raspar o Google Maps vai contra os termos do Google: em volume alto o IP pode ser bloqueado (usar proxy).
