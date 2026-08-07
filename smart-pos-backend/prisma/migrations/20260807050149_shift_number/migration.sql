-- Shift.shiftNumber: human-readable reference (SHIFT-000001) for X/Z reports.
--
-- Added in three steps rather than one: the column is NOT NULL UNIQUE, and a
-- plain ADD COLUMN would fail on any table that already has shifts. So add it
-- nullable, backfill deterministically by open time, then enforce.

-- 1. Add nullable.
ALTER TABLE "shifts" ADD COLUMN "shiftNumber" TEXT;

-- 2. Backfill existing rows in the order they were opened, so the numbering
--    matches the chronology staff would expect.
UPDATE "shifts" AS s
SET "shiftNumber" = 'SHIFT-' || LPAD(numbered.seq::text, 6, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "openedAt", id) AS seq
  FROM "shifts"
) AS numbered
WHERE s.id = numbered.id;

-- 3. Enforce the constraints now that every row has a value.
ALTER TABLE "shifts" ALTER COLUMN "shiftNumber" SET NOT NULL;
CREATE UNIQUE INDEX "shifts_shiftNumber_key" ON "shifts"("shiftNumber");
