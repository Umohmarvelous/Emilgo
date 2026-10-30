#!/bin/zsh
# The owner's test site: the game on Cloudflare Pages (milgogames.pages.dev),
# online play through a game server on this Mac behind a Cloudflare quick tunnel.
#
#   games/emilgo-games/scripts/play-live.sh         build the last commit, start, publish
#   games/emilgo-games/scripts/play-live.sh stop    stop the server and the tunnel
#
# It builds what is committed (HEAD), never the working tree. The tunnel's address
# changes every start, so each start publishes the site again pointing at it.
# The Mac must stay on and awake while people play (caffeinate holds it awake).
set -e
G="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="$G/data/live"
PORT=8799
PROJECT=milgogames
SITE="https://$PROJECT.pages.dev"

stop() {
  pkill -f "$LIVE/index.mjs" 2>/dev/null || true
  pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" 2>/dev/null || true
}
if [[ "$1" == "stop" ]]; then stop; echo "stopped"; exit 0; fi

mkdir -p "$LIVE/data"
[[ -f "$LIVE/admin_token" ]] || { openssl rand -hex 24 > "$LIVE/admin_token"; chmod 600 "$LIVE/admin_token"; }

# The last commit, outside the working tree.
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git -C "$G" archive --format=tar HEAD . | tar -x -C "$SRC"
ln -s "$G/node_modules" "$SRC/node_modules"
(cd "$SRC" && node server/build.mjs > /dev/null)
cp "$SRC/server/dist/index.mjs" "$LIVE/index.mjs"

stop
sleep 0.5
cd "$LIVE"
PORT=$PORT DATA_DIR="$LIVE/data" TRUST_PROXY=1 GAMES_ORIGINS="$SITE" ADMIN_TOKEN="$(cat "$LIVE/admin_token")" \
  nohup node "$LIVE/index.mjs" > "$LIVE/server.log" 2>&1 &
SERVER=$!
nohup caffeinate -i -w $SERVER > /dev/null 2>&1 &
nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LIVE/tunnel.log" 2>&1 &

echo "waiting for the tunnel…"
TUNNEL=""
for i in {1..60}; do
  TUNNEL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LIVE/tunnel.log" | head -1 || true)"
  [[ -n "$TUNNEL" ]] && break
  sleep 1
done
[[ -n "$TUNNEL" ]] || { echo "no tunnel address after 60 s; see $LIVE/tunnel.log"; exit 1; }
WSS="wss://${TUNNEL#https://}"

(cd "$SRC" && VITE_GAMES_SERVER="$WSS" npx vite build --mode emilgo --outDir "$LIVE/site" --emptyOutDir > /dev/null)
(cd "$LIVE" && wrangler pages deploy site --project-name $PROJECT --branch main --commit-dirty=true \
  --commit-message "play-live $(git -C "$G" rev-parse --short HEAD)" | tail -1)

echo ""
echo "play: $SITE"
echo "game server: $WSS (this Mac, port $PORT)"
echo "stop: $0 stop"
