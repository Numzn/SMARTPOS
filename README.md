# SMARTPOS on Numzlab

SMARTPOS is **fully independent** from NUMZFLEET and other homelab projects. It has its own Postgres (port **5434**), network (`smartpos_default`), and volumes.

## Server path

Live deployment: `/srv/projects/smartpos` (cloned from [github.com/Numzn/SMARTPOS](https://github.com/Numzn/SMARTPOS))

## Deploy (numzlab only)

Always use the numzlab override — never bare `docker compose up` (that pulls `nginx` from Docker Hub):

```bash
ssh homelab
cd /srv/projects/smartpos
./scripts/deploy-numzlab.sh --no-seed   # updates without re-seeding DB
```

Or use the compose wrapper:

```bash
./scripts/compose-numzlab.sh ps
./scripts/compose-numzlab.sh up -d --build
```

## Numzlab-specific files (mirror)

These files live in the SMARTPOS repo for numzlab; they do not change the default dev `docker-compose.yml`:

| File | Purpose |
|------|---------|
| `docker-compose.numzlab.yml` | Caddy frontend, `pull_policy: never`, `build.pull: false` |
| `smart-pos-frontend/Dockerfile.caddy` | Frontend image (Caddy, not nginx) |
| `smart-pos-frontend/Caddyfile` | Reverse proxy `/api` → backend |
| `scripts/deploy-numzlab.sh` | Safe deploy from source only |
| `scripts/compose-numzlab.sh` | Compose wrapper with override |

## Access

| Service | LAN | Tailscale |
|---------|-----|-----------|
| UI | http://192.168.1.147:8080 | http://100.121.79.2:8080 |
| API | :4000/api/health | same |
| Postgres | :5434 | same |

## Not SMARTPOS (separate stacks)

NUMZFLEET image pulls (`numz14/numzfleet-*`) come from `/srv/projects/numzfleet/deployment/compose/docker-compose.staging.yml` — a different compose project. They are not triggered by SMARTPOS deploy scripts.
