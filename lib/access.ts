// lib/access.ts
//
// Controle de acesso a empresas compartilhadas: uma empresa (MarkupRuleset) pertence a
// uma conta "dona" (userId), mas outros usuários podem receber acesso completo a ela via
// EmpresaAccess (concedido por um usuário MASTER na tela /usuarios). Produtos e dados de
// precificação são compartilhados entre quem tem acesso — por isso as consultas usam o id
// do DONO da empresa, não o do usuário logado no momento.
import { prisma } from "@/lib/prisma";

export type EmpresaAccessInfo = { ownerUserId: string; isOwner: boolean };

/**
 * Verifica se `userId` pode acessar `empresaId` (dono OU concessão) e devolve o id do
 * dono de verdade. Retorna null se a empresa não existe ou o usuário não tem acesso.
 */
export async function getEmpresaAccess(userId: string, empresaId: string): Promise<EmpresaAccessInfo | null> {
  const empresa = await prisma.markupRuleset.findUnique({
    where: { id: empresaId },
    select: { userId: true },
  });
  if (!empresa) return null;
  if (empresa.userId === userId) return { ownerUserId: empresa.userId, isOwner: true };

  const grant = await prisma.empresaAccess.findUnique({
    where: { userId_empresaId: { userId, empresaId } },
  });
  if (!grant) return null;
  return { ownerUserId: empresa.userId, isOwner: false };
}

/**
 * Lista os ids de empresa que `userId` pode ver: as que ele é dono + as concedidas.
 */
export async function getAccessibleEmpresaIds(userId: string): Promise<string[]> {
  const [owned, granted] = await Promise.all([
    prisma.markupRuleset.findMany({ where: { userId }, select: { id: true } }),
    prisma.empresaAccess.findMany({ where: { userId }, select: { empresaId: true } }),
  ]);
  return [...owned.map((o) => o.id), ...granted.map((g) => g.empresaId)];
}
