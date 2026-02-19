-- CreateTable
CREATE TABLE "markup_settings_rulesets_v1" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markup_settings_rulesets_v1_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "markup_settings_rulesets_v1_userId_idx" ON "markup_settings_rulesets_v1"("userId");
