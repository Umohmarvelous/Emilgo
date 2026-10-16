# EMILGO Games server. Easiest: `docker compose up -d --build` (docker-compose.yml).
# By hand, from games/emilgo-games:
#   docker build -f server/Dockerfile -t emilgo-games-server .
#   docker run -p 8787:8787 -v emilgo-data:/data \
#     -e GAMES_ORIGINS=https://your-game.example \
#     -e VATAR_SECRET=… -e VATAR_RESULTS_SECRET=… -e VATAR_WEBHOOK_SECRET=… \
#     -e TICKET_SECRET=… -e ADMIN_TOKEN=… emilgo-games-server
#
# /data holds the purchases database: mount a PERSISTENT volume there, or
# players lose what they bought when the container is replaced.
#
# Put it behind TLS (wss://) — browsers block ws:// from https pages — and, if
# you run several, a load balancer that keeps a connection on one instance.

FROM node:22.23.3-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run server:build

# Node 22.13+ has node:sqlite built in (used for purchases).
FROM node:22.23.3-alpine3.24
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
RUN npm install --omit=dev --no-save --no-audit --no-fund ws@8.22.0
COPY --from=build /app/server/dist/index.mjs /app/server/dist/index.mjs.map ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "--enable-source-maps", "--no-warnings=ExperimentalWarning", "index.mjs"]
