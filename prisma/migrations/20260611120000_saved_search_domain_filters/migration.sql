-- AlterTable
ALTER TABLE "SavedSearch" ALTER COLUMN "query" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN "domain" TEXT;
ALTER TABLE "SavedSearch" ADD COLUMN "subdomain" TEXT;
ALTER TABLE "SavedSearch" ADD COLUMN "ln" TEXT;
