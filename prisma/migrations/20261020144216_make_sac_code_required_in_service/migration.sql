/*
  Warnings:

  - Made the column `sacCode` on table `Service` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill unique 6-digit SAC codes for existing services where sacCode is null
WITH numbered AS (
  SELECT id, (999720 + ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC))::text AS new_sac
  FROM "Service"
  WHERE "sacCode" IS NULL
)
UPDATE "Service" s
SET "sacCode" = n.new_sac
FROM numbered n
WHERE s.id = n.id;

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "sacCode" SET NOT NULL;
