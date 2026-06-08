# Smart POS

Full-stack point-of-sale system with ZRA/VSDC compliance, inventory management, and a modern cashier UI.

| Layer    | Stack                          | Port (dev) |
|----------|--------------------------------|------------|
| Frontend | React 19, Vite, Tailwind, nginx | 5173 / 8080 (Docker) |
| Backend  | Express 5, Prisma, PostgreSQL  | 4000       |
| Mock VSDC| Node (ZRA compliance mock)     | 8090       |

**Repository:** [github.com/Numzn/SMARTPOS](https://github.com/Numzn/SMARTPOS)

## Quick start (Docker)

```bash
cp .env.docker.example .env   # edit JWT_SECRET and POSTGRES_PASSWORD
npm run docker:up
```

Open http://localhost:8080 — default seed users are in [DEPLOY.md](DEPLOY.md).

## Local development

```bash
npm install                   # workspace install (root)
cd smart-pos-backend && npm run db:up && npm run setup-db
npm start                     # frontend + backend via dev-helper
```

See [DEV_GUIDE.md](DEV_GUIDE.md) for VS Code tasks and detailed workflows.

## Deployment

Production deployment (GitHub push, Numzlab server, Docker Compose, backups) is documented in **[DEPLOY.md](DEPLOY.md)**.

## Project layout

```
smart-pos-frontend/   React SPA (cashier, dashboard, inventory, reports)
smart-pos-backend/    REST API, Prisma, ZRA/VSDC services
docker-compose.yml    Full stack: Postgres + backend + frontend + mock VSDC
scripts/              Deploy and smoke-test scripts
```

## CI

GitHub Actions runs on push/PR to `main`: Prisma migrations, backend validation, frontend build, and Docker image builds (see `.github/workflows/ci.yml`).
