# Database — self-hosted PostgreSQL

Smart POS uses **PostgreSQL only** via Prisma. There is no Supabase dependency.

## Quick start (Docker on your machine)

```bash
# 1. Copy env and adjust passwords
cp .env.example .env

# 2. Start Postgres
docker compose up -d

# 3. Apply schema and seed
npx prisma db push
npx prisma db seed

# 4. Run API
npm run dev
```

Default connection (matches `docker-compose.yml`):

```
postgresql://smartpos:smartpos_dev_change_me@localhost:5432/smartpos
```

## Your own server (VPS / bare metal)

Install PostgreSQL 14+ on the host, then:

```sql
CREATE USER smartpos WITH PASSWORD 'your-strong-password';
CREATE DATABASE smartpos OWNER smartpos;
```

Set in `.env`:

```
DATABASE_URL="postgresql://smartpos:your-strong-password@your-server-ip:5432/smartpos"
```

Open port `5432` only to your app server (firewall / private network). Do not expose Postgres to the public internet without TLS and strict rules.

## Migrations

After switching from SQLite, old migration files are SQLite-specific. For a fresh Postgres database:

```bash
npx prisma db push          # dev: sync schema quickly
# or
npx prisma migrate dev        # when you want versioned migrations
```

Production:

```bash
npx prisma migrate deploy
```

## Backup (self-hosted)

```bash
docker exec smart-pos-postgres pg_dump -U smartpos smartpos > backup.sql
```

Restore:

```bash
cat backup.sql | docker exec -i smart-pos-postgres psql -U smartpos smartpos
```

## What runs where (typical self-host)

| Service        | Default port | Notes                    |
|----------------|-------------|--------------------------|
| PostgreSQL     | 5432        | `docker-compose.yml`     |
| Smart POS API  | 4000        | `npm run dev`            |
| Mock ZRA VSDC  | 8090        | `npm run mock-vsdc`      |
| Frontend       | 5173        | `smart-pos-frontend`     |

All of these can run on one VPS or split across machines; only `DATABASE_URL` must reach Postgres.
