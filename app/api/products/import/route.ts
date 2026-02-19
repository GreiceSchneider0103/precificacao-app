import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrThrow } from "@/lib/utils"; // Importando o helper que criamos
import { z } from "zod";

// Validando a estrutura de cada produto vindo do front-end
const productSchema = z.object({
  sku: z.string(),
  name: z.string(),
  cmv: z.coerce.number(), // Usando cmv conforme seu schema
  mlb: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Validar sessão
    const session = await getSessionOrThrow();
    const userId = session.user.id;

    // 2. Pegar os produtos do body (Enviados pelo front após parsear o Excel)
    const { products } = await req.json();

    if (!Array.isArray(products)) {
      return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
    }

    const results = { created: 0, updated: 0, errors: [] as string[] };
    const BATCH_SIZE = 50; // Lotes menores para maior estabilidade

    // 3. Processar em lotes (Batching)
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);

      await prisma.$transaction(
        batch.map((p: any) => {
          try {
            const data = productSchema.parse(p);
            
            // Incrementando contadores (Lógica simplificada para o exemplo)
            results.created++; 

            // Upsert usando a chave composta [userId, sku] definida no seu Schema
            return prisma.product.upsert({
              where: {
                userId_sku: {
                  userId: userId,
                  sku: data.sku,
                },
              },
              update: {
                name: data.name,
                cmv: data.cmv,
                mlb: data.mlb,
                deletedAt: null, // "Restaura" caso estivesse deletado
              },
              create: {
                sku: data.sku,
                name: data.name,
                cmv: data.cmv,
                mlb: data.mlb,
                userId: userId,
              },
            });
          } catch (err: any) {
            results.errors.push(`Erro no SKU ${p.sku}: ${err.message}`);
            return prisma.product.findFirst({ where: { id: '0' } }); // Query dummy para não quebrar a transação
          }
        })
      );
    }

    return NextResponse.json({
      message: "Importação concluída",
      summary: results
    });

  } catch (error: any) {
    console.error("Erro na importação:", error);
    return NextResponse.json(
      { error: error.message === "Unauthorized" ? "Não autorizado" : "Erro interno na importação" },
      { status: error.message === "Unauthorized" ? 401 : 500 }
    );
  }
}