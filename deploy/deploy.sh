#!/usr/bin/env bash
# Build, test, sync to /srv/circuit, install the systemd unit and nginx site, restart. Idempotent.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/srv/circuit
UNIT_SRC="$REPO/deploy/circuit.service"; UNIT_DST=/etc/systemd/system/circuit.service
NGX_SRC="$REPO/deploy/nginx-circuit.conf"; NGX_DST=/etc/nginx/conf.d/circuit.conf
ENV_FILE=/etc/circuit/env

say() { printf '\n==> %s\n' "$*"; }

cd "$REPO"
say "Installing dependencies, building, testing"
npm ci
npm run build
npm test

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy deploy/env.example there, set SESSION_SECRET (openssl rand -hex 32) and any AI keys, chmod 600." >&2
  exit 1
fi

say "Syncing to $DEST"
sudo mkdir -p "$DEST"
sudo chown "$USER":"$USER" "$DEST"
rsync -a --delete --exclude node_modules \
  dist server src package.json package-lock.json tsconfig.json "$DEST"/
COMMIT="$(git rev-parse --short HEAD)"

say "Installing runtime dependencies in $DEST"
# tsx is a runtime dependency; production installs skip dev dependencies.
(cd "$DEST" && npm ci --omit=dev)

install_if_changed() { # src dst
  if ! sudo cmp -s "$1" "$2"; then sudo cp "$1" "$2"; echo "installed $2"; return 0; else echo "unchanged $2"; return 1; fi
}

say "systemd unit"
UNIT_CHANGED=0; install_if_changed "$UNIT_SRC" "$UNIT_DST" && UNIT_CHANGED=1 || true
if ! sudo grep -q '^COMMIT_SHA=' "$ENV_FILE"; then echo "COMMIT_SHA=$COMMIT" | sudo tee -a "$ENV_FILE" >/dev/null; else sudo sed -i "s/^COMMIT_SHA=.*/COMMIT_SHA=$COMMIT/" "$ENV_FILE"; fi
sudo systemctl daemon-reload
sudo systemctl enable --now circuit
sudo systemctl restart circuit
sleep 1
sudo systemctl --no-pager --lines=5 status circuit || true

say "nginx site"
if sudo test -d /etc/letsencrypt/live/circuit.davidwolinsky.com; then
  install_if_changed "$NGX_SRC" "$NGX_DST" || true
else
  # No certificate yet: install only the port-80 server (ACME challenge path + redirect) so nginx stays valid.
  # Then: sudo certbot certonly --webroot -w /var/lib/letsencrypt -d circuit.davidwolinsky.com ; and re-run this script.
  TMP80="$(mktemp)"; awk '/^server \{/{n++} n==1' "$NGX_SRC" > "$TMP80"
  install_if_changed "$TMP80" "$NGX_DST" || true; rm -f "$TMP80"
  echo "No certificate for circuit.davidwolinsky.com yet; installed the port-80 site only." >&2
  echo "Once DNS points here: sudo certbot certonly --webroot -w /var/lib/letsencrypt -d circuit.davidwolinsky.com && $0" >&2
fi
sudo nginx -t && sudo systemctl reload nginx

say "Verify"
curl -fsS http://127.0.0.1:8797/healthz && echo
echo "Deployed commit $COMMIT. Open https://circuit.davidwolinsky.com/ on a phone and log in."
