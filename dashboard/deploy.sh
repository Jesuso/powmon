#!/usr/bin/env bash
# Deploy the PowMon web dashboard to the Pi.
#
# Ships the committed tree (git archive HEAD:dashboard — uncommitted changes are NOT
# deployed), rebuilds on the Pi, restarts the systemd user service, then
# verifies the service is active and the API is healthy.
#
# Usage:
#   ./deploy.sh             # normal deploy
#   ./deploy.sh --install   # also run `npm ci` on the Pi (after dep changes)
#
# Overridable env (put personal values in deploy.env next to this script —
# it is gitignored and sourced below):
#   PI_HOST   (default pi@raspberrypi.local)
#   PI_DIR    (default ~/powmon/dashboard)
#   SERVICE   (default solar-web)
set -euo pipefail

cd "$(dirname "$0")"
[[ -f deploy.env ]] && source deploy.env

PI_HOST="${PI_HOST:-pi@raspberrypi.local}"
PI_DIR="${PI_DIR:-\$HOME/powmon/dashboard}"
SERVICE="${SERVICE:-solar-web}"
INSTALL=0
[[ "${1:-}" == "--install" ]] && INSTALL=1

if ! git diff --quiet HEAD; then
  echo "WARNING: working tree is dirty — deploying HEAD ($(git rev-parse --short HEAD)), not your local edits." >&2
fi

echo "==> sync $(git rev-parse --short HEAD) -> $PI_HOST:$PI_DIR"
git archive HEAD:dashboard | ssh "$PI_HOST" "tar -x -C $PI_DIR"

if [[ $INSTALL -eq 1 ]]; then
  echo "==> npm ci on Pi"
  ssh "$PI_HOST" "cd $PI_DIR && npm ci"
fi

echo "==> build + restart $SERVICE"
ssh "$PI_HOST" "cd $PI_DIR && npm run build 2>&1 | tail -3 \
  && export XDG_RUNTIME_DIR=/run/user/\$(id -u) \
  && systemctl --user restart $SERVICE && sleep 3 \
  && systemctl --user is-active $SERVICE"

echo "==> health check"
ssh "$PI_HOST" "curl -sf http://127.0.0.1:3001/api/health"
echo
echo "==> deployed. dashboard: http://${PI_HOST#*@}:3001"
