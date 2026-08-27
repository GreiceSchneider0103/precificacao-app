-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: contas já existentes (criadas antes deste recurso) continuam aprovadas —
-- só cadastros novos a partir de agora (via /cadastro) nascem pendentes de aprovação.
UPDATE "User" SET "approved" = true;

-- AlterTable: cadastros novos passam a nascer como MEMBER, não MASTER — MASTER agora é
-- reservado às contas que já existiam (dono da conta), concedidas manualmente.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "EmpresaAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpresaAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmpresaAccess_userId_empresaId_key" ON "EmpresaAccess"("userId", "empresaId");

-- CreateIndex
CREATE INDEX "EmpresaAccess_empresaId_idx" ON "EmpresaAccess"("empresaId");

-- AddForeignKey
ALTER TABLE "EmpresaAccess" ADD CONSTRAINT "EmpresaAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpresaAccess" ADD CONSTRAINT "EmpresaAccess_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "markup_settings_rulesets_v1"("id") ON DELETE CASCADE ON UPDATE CASCADE;
