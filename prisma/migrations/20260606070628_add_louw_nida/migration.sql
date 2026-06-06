-- AlterTable
ALTER TABLE "Token" ADD COLUMN "louwNida" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "lnDomain" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "LouwNidaDomain" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "parentCode" TEXT,

    CONSTRAINT "LouwNidaDomain_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "LouwNidaDomain_parentCode_idx" ON "LouwNidaDomain"("parentCode");

-- CreateIndex
CREATE INDEX "Token_lnDomain_idx" ON "Token" USING GIN ("lnDomain");
