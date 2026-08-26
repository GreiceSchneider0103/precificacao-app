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
    const { products, empresaId } = await req.json();

    if (!Array.isArray(products)) {
      return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
    }
    // Import sempre acontece no contexto de uma empresa selecionada na tela — exigimos
    // aqui para manter o upsert pela chave composta simples (Prisma não aceita null
    // num campo de chave única composta dentro de um upsert em lote/transação).
    if (!empresaId || typeof empresaId !== "string") {
      return NextResponse.json({ error: "Selecione uma empresa antes de importar" }, { status: 400 });
    }
    const empresaIdNorm = empresaId;

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

            // Upsert usando a chave composta [userId, empresaId, sku] definida no schema
            return prisma.product.upsert({
              where: {
                userId_empresaId_sku: {
                  userId: userId,
                  empresaId: empresaIdNorm,
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
                empresaId: empresaIdNorm,
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