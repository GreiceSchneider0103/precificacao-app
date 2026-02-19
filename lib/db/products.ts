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