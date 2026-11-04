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
# The game's pages too, served when SITE_DIR=/app/site (fly.toml). VITE_GAMES_SERVER
# is the wss:// address the pages connect to. gzip copies save the server the work.
ARG VITE_GAMES_SERVER=""
RUN VITE_GAMES_SERVER="$VITE_GAMES_SERVER" npx vite build --mode web --outDir /app/site --emptyOutDir \
  && rm -f /app/site/_headers \
  && find /app/site -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.bin' -o -name '*.glb' -o -name '*.hdr' \) -exec gzip -9 -k {} +

# Node 22.13+ has node:sqlite built in (used for purchases).
FROM node:22.23.3-alpine3.24
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
RUN npm install --omit=dev --no-save --no-audit --no-fund ws@8.22.0
COPY --from=build /app/server/dist/index.mjs /app/server/dist/index.mjs.map ./
COPY --from=build /app/site ./site
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "--enable-source-maps", "--no-warnings=ExperimentalWarning", "index.mjs"]
