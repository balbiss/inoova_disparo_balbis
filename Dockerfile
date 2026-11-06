# Um container só: a API (Node) serve também o painel já buildado (pasta web/).
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npx vite build

FROM node:22-bookworm-slim AS api
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3020 WEB_DIR=/app/web UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY server/package.json ./
COPY server/drizzle ./drizzle
COPY --from=web /app/dist ./web
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3020
CMD ["node", "dist/index.js"]
