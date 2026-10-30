#!/bin/zsh
# Publish the game: the Cloudflare Pages project `milgogames`
# (https://milgogames.pages.dev; later https://play.emilgo.app), talking to the
# game server on Fly. Builds what is committed (HEAD), never the working tree.
#
#   games/emilgo-games/scripts/deploy-site.sh
#   SERVER=wss://api.emilgo.app games/emilgo-games/scripts/deploy-site.sh   (once the domain is bought)
set -e
G="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${SERVER:-wss://emilgo-games.fly.dev}"
PROJECT=milgogames
OUT="$(mktemp -d)"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC" "$OUT"' EXIT

git -C "$G" archive --format=tar HEAD . | tar -x -C "$SRC"
ln -s "$G/node_modules" "$SRC/node_modules"
(cd "$SRC" && VITE_GAMES_SERVER="$SERVER" npx vite build --mode emilgo --outDir "$OUT/site" --emptyOutDir > /dev/null)
(cd "$OUT" && wrangler pages deploy site --project-name $PROJECT --branch main --commit-dirty=true \
  --commit-message "deploy $(git -C "$G" rev-parse --short HEAD) → $SERVER" | tail -1)
echo "play: https://$PROJECT.pages.dev"
echo "game server: $SERVER"
