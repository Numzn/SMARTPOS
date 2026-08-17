-- The actual concurrency guarantee behind auto-created shifts: at most one
-- OPEN or INITIALIZING shift per (user, branch) at a time, enforced by
-- Postgres itself rather than application-level locking. This is a partial
-- (filtered) unique index, which has no schema.prisma representation — see
-- the comment on the Shift model. It is therefore invisible to `prisma db
-- push` and to any future migration-history baseline reset; if this index is
-- ever missing, ensureShiftForLogin() can create duplicate active shifts for
-- the same cashier. tests/integration/shiftInitialization.integration.test.js
-- asserts its existence so a silent drop fails CI instead of surfacing live.
CREATE UNIQUE INDEX "shifts_active_user_branch_key" ON "shifts" ("userId", "branchId") WHERE "status" IN ('OPEN', 'INITIALIZING');
