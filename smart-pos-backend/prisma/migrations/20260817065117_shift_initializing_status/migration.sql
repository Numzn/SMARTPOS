-- Adds the INITIALIZING status: a shift exists (shiftNumber allocated) but the
-- cashier has not yet confirmed their opening cash count. Split into its own
-- migration because Postgres forbids using a freshly-added enum value inside
-- the same transaction that adds it — the partial unique index referencing
-- this value lives in the next migration.
ALTER TYPE "ShiftStatus" ADD VALUE 'INITIALIZING';
