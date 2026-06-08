#!/usr/bin/env bash
# Deploy Smart POS to the Numzlab server via Docker Compose.
# Run from the repo root: ./scripts/deploy-numzlab.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PULL=false
NO_SEED=false

for arg in "$@"; do
  case "$arg" in
    --pull)    PULL=true ;;
    --no-seed) NO_SEED=true ;;
    -h|--help)
      echo "Usage: $0 [--pull] [--no-seed]"
      echo "  --pull     git pull origin main before building"
      echo "  --no-seed  set SEED_ON_BOOT=false in .env (safe for updates)"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed. See DEPLOY.md for server setup."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose v2 is required."
  exit 1
fi

if [ "$PULL" = true ]; then
  echo "[deploy] pulling latest from origin/main..."
  git pull origin main
fi

if [ ! -f .env ]; then
  if [ -f .env.docker.example ]; then
    echo "[deploy] creating .env from .env.docker.example — edit secrets before production use!"
    cp .env.docker.example .env
  else
    echo "ERROR: no .env file. Copy .env.docker.example to .env and configure it."
    exit 1
  fi
fi

if [ "$NO_SEED" = true ]; then
  if grep -q '^SEED_ON_BOOT=' .env; then
    sed -i.bak 's/^SEED_ON_BOOT=.*/SEED_ON_BOOT=false/' .env
  else
    echo 'SEED_ON_BOOT=false' >> .env
  fi
  echo "[deploy] SEED_ON_BOOT=false"
fi

echo "[deploy] building and starting stack..."
docker compose up -d --build

echo "[deploy] waiting for health checks..."
sleep 10

check() {
  local name="$1" url="$2"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "[OK]   $name — $url"
  else
    echo "[WARN] $name — $url (not ready yet; check: docker compose logs -f)"
  fi
}

check "backend"  "http://127.0.0.1:${BACKEND_PORT:-4000}/api/health"
check "frontend" "http://127.0.0.1:${FRONTEND_PORT:-8080}/"
check "mock-vsdc" "http://127.0.0.1:${MOCK_VSDC_PORT:-8090}/health"

echo ""
echo "[deploy] done. Frontend: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${FRONTEND_PORT:-8080}"
docker compose ps
