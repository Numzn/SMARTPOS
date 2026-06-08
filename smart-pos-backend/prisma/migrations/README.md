# Prisma migrations (PostgreSQL)

The history was reset on **2026-05-26** with a single Postgres baseline
generated from `schema.prisma`:

```
20260526000000_baseline_postgres/migration.sql
```

That baseline was marked as already applied against the live database with:

```bash
npx prisma migrate resolve --applied 20260526000000_baseline_postgres
```

So fresh databases get the baseline via `prisma migrate deploy`, and existing
databases stay in sync because the baseline is already recorded in
`_prisma_migrations`.

## Day-to-day commands

```bash
# Apply pending migrations (production-style)
npx prisma migrate deploy

# Create a new migration after a schema change (dev)
npx prisma migrate dev --name <change-description>

# One-off: push schema without creating a migration (rapid prototyping)
npx prisma db push
```

## Notes

- The legacy SQLite migration folders were deleted; the lock file now declares
  `provider = "postgresql"`.
- `docker compose up -d` (`npm run db:up`) brings up `smart-pos-postgres` on
  `localhost:5432`.
- See [../../docs/DATABASE.md](../../docs/DATABASE.md) for connection details.
