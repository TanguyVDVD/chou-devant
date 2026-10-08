#!/bin/sh
# Affiche l'adresse à envoyer aux amis (et rien d'autre).
cd "$(dirname "$0")" || exit 1

if grep -Eq '^TUNNEL_TOKEN=.+' .env 2>/dev/null; then
  echo "Tunnel nommé : l'adresse est celle que tu as configurée chez Cloudflare." >&2
  exit 0
fi

essais=0
while [ "$essais" -lt 30 ]; do
  url=$(docker compose logs --no-color tunnel 2>/dev/null \
    | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -n 1)
  if [ -n "$url" ]; then
    echo "$url"
    exit 0
  fi
  essais=$((essais + 1))
  sleep 1
done

echo "Pas de lien trouvé. Le jeu tourne-t-il ? Lance : docker compose up -d --build" >&2
exit 1
