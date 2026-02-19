/*
  Warnings:

  - You are about to alter the column `cmv` on the `PricingHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `suggestedPrice` on the `PricingHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `finalPrice` on the `PricingHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `margin` on the `PricingHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(5,2)`.
  - You are about to alter the column `cmv` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `originalPrice` on the `Promotion` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `promoPrice` on the `Promotion` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.

*/
-- DropIndex
DROP INDEX "PricingHistory_userId_channel_idx";

-- DropIndex
DROP INDEX "Product_userId_idx";

-- DropIndex
DROP INDEX "Promotion_userId_channel_idx";

-- AlterTable
ALTER TABLE "PricingHistory" ALTER COLUMN "cmv" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "suggestedPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "finalPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "margin" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "cmv" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Promotion" ALTER COLUMN "originalPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "promoPrice" SET DATA TYPE DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "PricingHistory_userId_sku_idx" ON "PricingHistory"("userId", "sku");

-- CreateIndex
CREATE INDEX "Product_userId_deletedAt_idx" ON "Product"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Promotion_userId_channel_sku_idx" ON "Promotion"("userId", "channel", "sku");

-- AddForeignKey
ALTER TABLE "markup_settings_rulesets_v1" ADD CONSTRAINT "markup_settings_rulesets_v1_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
