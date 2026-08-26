// lib/db/products.ts
import { prisma } from "@/lib/prisma";

/**
 * Busca um produto garantindo que pertença ao usuário
 */
export async function getOwnedProduct(id: string, userId: string) {
  return await prisma.product.findFirst({
    where: {
      id,
      userId,
      deletedAt: null, // Garante que não pega produtos excluídos (Soft Delete)
    },
  });
}

/**
 * Lista produtos do usuário (apenas ativos)
 */
export async function listOwnedProducts(userId: string) {
  return await prisma.product.findMany({
    where: {
      userId,
      deletedAt: null,
      cmv: { gt: 0 }
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Deleta (Soft Delete) um produto garantindo propriedade
 */
export async function deleteOwnedProduct(id: string, userId: string) {
  return await prisma.product.updateMany({
    where: {
      id,
      userId,
    },
    data: {
      deletedAt: new Date(),
    },
  });
}

/**
 * Cria ou atualiza um produto pelo trio userId+empresaId+sku.
 *
 * O Prisma não aceita `null` num campo que faz parte de uma chave composta única
 * dentro de `where` (NULL nunca é igual a NULL em SQL, então a constraint não
 * garante unicidade ali) — por isso, quando o produto ainda não tem empresa
 * atribuída (`empresaId: null`, caso legado), fazemos um find manual em vez de
 * usar o atalho `upsert()` com a chave composta.
 */
export async function upsertProductBySku(params: {
  userId: string;
  empresaId: string | null;
  sku: string;
  name: string;
  cmv: number;
  mlb?: string | null;
  restoreDeleted?: boolean;
}) {
  const { userId, empresaId, sku, name, cmv, mlb = null, restoreDeleted = false } = params;

  if (empresaId !== null) {
    return prisma.product.upsert({
      where: { userId_empresaId_sku: { userId, empresaId, sku } },
      update: { name, cmv, mlb, updatedAt: new Date(), ...(restoreDeleted ? { deletedAt: null } : {}) },
      create: { userId, empresaId, sku, name, cmv, mlb },
    });
  }

  const existing = await prisma.product.findFirst({ where: { userId, empresaId: null, sku } });
  if (existing) {
    return prisma.product.update({
      where: { id: existing.id },
      data: { name, cmv, mlb, updatedAt: new Date(), ...(restoreDeleted ? { deletedAt: null } : {}) },
    });
  }
  return prisma.product.create({ data: { userId, empresaId: null, sku, name, cmv, mlb } });
}