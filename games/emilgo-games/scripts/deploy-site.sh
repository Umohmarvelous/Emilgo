#!/bin/zsh
# Publish the game to its permanent home: https://play.emilgo.app (the
# Cloudflare Pages project `milgogames`), talking to the game server on Fly
# (wss://api.emilgo.app). Builds what is committed (HEAD), never the working tree.
#
#   games/emilgo-games/scripts/deploy-site.sh
#   SERVER=wss://other.example games/emilgo-games/scripts/deploy-site.sh
set -e
G="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${SERVER:-wss://api.emilgo.app}"
PROJECT=milgogames
OUT="$(mktemp -d)"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC" "$OUT"' EXIT

git -C "$G" archive --format=tar HEAD . | tar -x -C "$SRC"
ln -s "$G/node_modules" "$SRC/node_modules"
(cd "$SRC" && VITE_GAMES_SERVER="$SERVER" npx vite build --mode emilgo --outDir "$OUT/site" --emptyOutDir > /dev/null)
(cd "$OUT" && wrangler pages deploy site --project-name $PROJECT --branch main --commit-dirty=true \
  --commit-message "deploy $(git -C "$G" rev-parse --short HEAD) → $SERVER" | tail -1)
echo "play: https://play.emilgo.app (and https://$PROJECT.pages.dev)"
echo "game server: $SERVER"
