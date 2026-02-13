-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cmv" DOUBLE PRECISION NOT NULL,
    "mlb" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "priceFull" DOUBLE PRECISION NOT NULL,
    "priceFinal" DOUBLE PRECISION NOT NULL,
    "marginPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_userId_idx" ON "Product"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_sku_key" ON "Product"("userId", "sku");

-- CreateIndex
CREATE INDEX "RuleSet_userId_idx" ON "RuleSet"("userId");

-- CreateIndex
CREATE INDEX "PriceHistory_userId_idx" ON "PriceHistory"("userId");

-- CreateIndex
CREATE INDEX "PriceHistory_userId_sku_idx" ON "PriceHistory"("userId", "sku");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleSet" ADD CONSTRAINT "RuleSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
