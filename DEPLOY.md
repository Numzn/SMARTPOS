# Smart POS — Deployment Guide

Deploy the full stack (PostgreSQL + backend + frontend + mock VSDC) to **GitHub** and the **Numzlab server**.

| Service      | Port (default) | URL (local)                    |
|--------------|----------------|--------------------------------|
| Frontend     | 8080           | http://localhost:8080          |
| Backend API  | 4000           | http://localhost:4000/api/health |
| Mock VSDC    | 8090           | http://localhost:8090/health   |
| PostgreSQL   | 5432           | localhost:5432                 |

**Default seed users** (created on first boot only):

| Email                  | Password   | Role    |
|------------------------|------------|---------|
| admin@smartpos.com     | admin123   | ADMIN   |
| cashier@smartpos.com   | cashier123 | CASHIER |

---

## 1. Push to GitHub

Repository: **https://github.com/Numzn/SMARTPOS.git**

### One-time setup (if not already cloned on the server)

```bash
git remote -v
# should show: origin  https://github.com/Numzn/SMARTPOS.git
```

### Before you commit

1. **Never commit secrets** — `.env` files are gitignored. Use `.env.docker.example` as the template.
2. **Review changes** — the repo is a monorepo (`smart-pos-backend`, `smart-pos-frontend`, root `docker-compose.yml`).
3. **Install dependencies** (root lockfile covers both workspaces):

   ```bash
   npm install
   ```

### Commit and push

```bash
# From repo root (POSPROJECT/)
git add .
git status   # confirm no .env or node_modules staged
git commit -m "Prepare Smart POS for Docker deployment to Numzlab"
git push origin main
```

---

## 2. Deploy to Numzlab server

### Server requirements

- Linux (Ubuntu 22.04+ recommended)
- Docker Engine 24+ and Docker Compose v2
- Git
- Ports **80** or **8080** (frontend), **4000** (API, optional if using nginx proxy only)

### First-time server setup

```bash
# SSH into the Numzlab server, then:
sudo apt update && sudo apt install -y git docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in so docker group applies

sudo mkdir -p /opt/smartpos
sudo chown $USER:$USER /opt/smartpos
cd /opt/smartpos

git clone https://github.com/Numzn/SMARTPOS.git .
```

### Configure production environment

```bash
cp .env.docker.example .env
nano .env   # set strong values — see checklist below
```

**Production checklist** (edit `.env` next to `docker-compose.yml`):

| Variable           | Action |
|--------------------|--------|
| `POSTGRES_PASSWORD`| Set a long random password |
| `JWT_SECRET`       | Set a long random secret (64+ chars) |
| `SEED_ON_BOOT`     | `true` for first deploy, then `false` |
| `VSDC_URL`         | Point to real ZRA VSDC in production, or keep mock for testing |
| `BUSINESS_TPIN`    | Your registered TPIN |
| `BRANCH_ID`        | Your branch code |

### Deploy (manual)

```bash
cd /opt/smartpos
git pull origin main
docker compose pull          # if using pre-built images (optional)
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

### Deploy (automated script)

```bash
chmod +x scripts/deploy-numzlab.sh
./scripts/deploy-numzlab.sh
```

Options:

```bash
./scripts/deploy-numzlab.sh --pull          # git pull before build
./scripts/deploy-numzlab.sh --no-seed       # set SEED_ON_BOOT=false for updates
```

### Verify deployment

```bash
curl -s http://localhost:8080/api/health
curl -s http://localhost:4000/api/health
curl -s http://localhost:8090/health
```

Open the frontend in a browser: `http://<server-ip>:8080`

Login with `admin@smartpos.com` / `admin123`, then **change passwords immediately**.

---

## 3. Operations

### View logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### Restart a service

```bash
docker compose restart backend
```

### Update after a GitHub push

```bash
cd /opt/smartpos
git pull origin main
docker compose up -d --build
```

### Backup PostgreSQL

```bash
docker compose exec postgres pg_dump -U smartpos smartpos > backup-$(date +%F).sql
```

### Restore

```bash
cat backup-2026-06-08.sql | docker compose exec -T postgres psql -U smartpos smartpos
```

### Stop / reset

```bash
docker compose down          # stop containers
docker compose down -v       # stop + delete database volume (destructive)
```

---

## 4. Reverse proxy (optional)

For HTTPS on a domain (e.g. `pos.numzlab.com`), put **Caddy** or **nginx** in front of port 8080:

```nginx
server {
    listen 443 ssl;
    server_name pos.numzlab.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The frontend nginx container already proxies `/api/*` to the backend — no extra API routing needed.

---

## 5. Local development (reference)

```bash
# Full Docker stack
npm run docker:up

# Or backend only with local Postgres
cd smart-pos-backend
npm run db:up
npm run setup-db
npm run dev
```

See `DEV_GUIDE.md` for full local workflow.
