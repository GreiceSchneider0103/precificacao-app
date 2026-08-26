-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MASTER', 'MEMBER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'MASTER';

-- AlterTable
ALTER TABLE "markup_settings_rulesets_v1" ADD COLUMN     "tinyApiToken" TEXT,
ADD COLUMN     "tinyLastSyncAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "empresaId" TEXT;

-- Backfill: atribui cada produto existente à empresa padrão (isActive=true) da mesma
-- conta, quando existir. Produtos de contas sem nenhuma empresa cadastrada ficam com
-- empresaId NULL ("Sem empresa") até serem reatribuídos manualmente na tela.
UPDATE "Product" p
SET "empresaId" = (
  SELECT r."id"
  FROM "markup_settings_rulesets_v1" r
  WHERE r."userId" = p."userId" AND r."isActive" = true
  LIMIT 1
);

-- DropIndex
DROP INDEX "Product_userId_sku_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_empresaId_sku_key" ON "Product"("userId", "empresaId", "sku");

-- CreateIndex
CREATE INDEX "Product_userId_empresaId_idx" ON "Product"("userId", "empresaId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "markup_settings_rulesets_v1"("id") ON DELETE SET NULL ON UPDATE CASCADE;
