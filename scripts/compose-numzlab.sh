#!/usr/bin/env bash
# Wrapper so docker compose on numzlab always includes numzlab overrides.
# Usage: ./scripts/compose-numzlab.sh ps
#        ./scripts/compose-numzlab.sh logs -f backend
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export COMPOSE_FILE="docker-compose.yml:docker-compose.numzlab.yml"
exec docker compose "$@"
