// app/configuracoes/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionOrThrow } from "@/lib/utils";

export async function saveMarkupRule(id: string, data: any) {
  const session = await getSessionOrThrow();

  await prisma.markupRuleset.update({
    where: { 
      id,
      userId: session.user.id // Garantia multi-tenant
    },
    data: {
      data: data,
      updatedAt: new Date(),
    },
  });

  // ✅ Tópico E: Limpa o cache do servidor para estas rotas
  revalidatePath("/precificacao");
  revalidatePath("/promocoes");
  
  return { success: true };
}