#!/usr/bin/env bash
# Validate, build, install into a new release directory, switch the `current` symlink, restart, smoke-test the live URL, roll back on failure.
# Layout: /srv/circuit/releases/<timestamp>-<commit>/ and /srv/circuit/current -> one of them. The last 3 releases are kept.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT=/srv/circuit; RELEASES=$ROOT/releases; CURRENT=$ROOT/current
UNIT_SRC="$REPO/deploy/circuit.service"; UNIT_DST=/etc/systemd/system/circuit.service
NGX_SRC="$REPO/deploy/nginx-circuit.conf"; NGX_DST=/etc/nginx/conf.d/circuit.conf
ENV_FILE=/etc/circuit/env; URL=${SMOKE_URL:-https://circuit.davidwolinsky.com}
say() { printf '\n==> %s\n' "$*"; }
cd "$REPO"
if [ -n "$(git status --porcelain)" ]; then echo "Working tree has uncommitted changes; commit first so the release is reproducible." >&2; exit 1; fi
COMMIT="$(git rev-parse --short HEAD)"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; REL="$RELEASES/$STAMP-$COMMIT"

say "Validating (typecheck, tests, sweep freshness, build)"
./scripts/validate.sh
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. Copy deploy/env.example there, set SESSION_SECRET (openssl rand -hex 32), chmod 600." >&2; exit 1; }

say "Installing release $REL"
sudo mkdir -p "$RELEASES"; sudo chown "$USER":"$USER" "$ROOT" "$RELEASES"
if [ -d "$ROOT/dist" ] && [ ! -L "$CURRENT" ]; then   # migrate the pre-release-directory layout once, keeping it as the rollback target
  LEGACY="$RELEASES/legacy-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$LEGACY"; for f in dist server src package.json package-lock.json tsconfig.json node_modules; do [ -e "$ROOT/$f" ] && mv "$ROOT/$f" "$LEGACY/"; done; ln -sfn "$LEGACY" "$CURRENT"; echo "moved legacy install to $LEGACY"
fi
PREV="$(readlink -f "$CURRENT" 2>/dev/null || true)"
mkdir -p "$REL"; rsync -a --exclude node_modules dist server src package.json package-lock.json tsconfig.json "$REL"/
(cd "$REL" && npm ci --omit=dev --silent)
sudo sed -i "s/^COMMIT_SHA=.*/COMMIT_SHA=$COMMIT/" "$ENV_FILE"; sudo grep -q '^COMMIT_SHA=' "$ENV_FILE" || echo "COMMIT_SHA=$COMMIT" | sudo tee -a "$ENV_FILE" >/dev/null

say "Switching current -> $REL and restarting"
install_if_changed() { if ! sudo cmp -s "$1" "$2"; then sudo cp "$1" "$2"; echo "installed $2"; else echo "unchanged $2"; fi; }
install_if_changed "$UNIT_SRC" "$UNIT_DST"; sudo systemctl daemon-reload
ln -sfn "$REL" "$CURRENT"; sudo systemctl enable --now circuit >/dev/null; sudo systemctl restart circuit; sleep 2
rollback() { echo "!! rolling back to ${PREV:-nothing}" >&2; if [ -n "$PREV" ] && [ -d "$PREV" ]; then ln -sfn "$PREV" "$CURRENT"; sudo systemctl restart circuit; sleep 2; sudo systemctl is-active circuit && echo "rolled back; current -> $PREV"; fi; exit 1; }
sudo systemctl is-active --quiet circuit || rollback
curl -fsS "http://127.0.0.1:$(sudo grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || echo 8797)/healthz" >/dev/null || rollback

say "nginx site"
if sudo test -d /etc/letsencrypt/live/circuit.davidwolinsky.com; then install_if_changed "$NGX_SRC" "$NGX_DST"; else TMP80="$(mktemp)"; awk '/^server \{/{n++} n==1' "$NGX_SRC" > "$TMP80"; install_if_changed "$TMP80" "$NGX_DST"; rm -f "$TMP80"; echo "No certificate yet; port-80 site only. Once DNS points here: sudo certbot certonly --webroot -w /var/lib/letsencrypt -d circuit.davidwolinsky.com" >&2; fi
sudo nginx -t >/dev/null && sudo systemctl reload nginx

say "Live smoke test against $URL"
GATE_USER="$(sudo grep -E '^GATE_USER=' "$ENV_FILE" | cut -d= -f2-)" GATE_PASS="$(sudo grep -E '^GATE_PASS=' "$ENV_FILE" | cut -d= -f2-)" node deploy/smoke.mjs "$URL" || rollback

say "Pruning old releases (keeping 3)"
ls -1dt "$RELEASES"/*/ | tail -n +4 | while read -r old; do [ "$(readlink -f "$old")" != "$(readlink -f "$CURRENT")" ] && rm -rf "$old" && echo "removed $old"; done || true
echo "Deployed commit $COMMIT -> $REL"
