// app/api/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listOwnedProducts } from "@/lib/db/products";

// ✅ Tópico E: Força a API a sempre buscar dados novos, sem cache da Vercel
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET: Lista produtos ativos do usuário logado
 */
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // ✅ Tópico C: Uso do Helper que isola o usuário e ignora os 'deletedAt'
    const products = await listOwnedProducts(userId);

    // Contagem para estatísticas do dashboard (opcional)
    const totalActive = await prisma.product.count({
      where: { userId, deletedAt: null },
    });

    return NextResponse.json({
      products,
      total: totalActive,
      // Retornamos os tipos como número, mas o Prisma cuidará da precisão Decimal no banco
    });
  } catch (error) {
    console.error("Erro na API de produtos (GET):", error);
    return NextResponse.json({ error: "Erro interno ao buscar produtos" }, { status: 500 });
  }
}

/**
 * POST: Cria ou restaura um produto
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json();
    const { sku, name, cmv, mlb } = body;

    // Validação básica
    if (!sku || !name || cmv === undefined) {
      return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
    }

    /**
     * ✅ Tópico A e C: Lógica de Identidade Multi-tenant
     * Usamos 'upsert' com a chave composta 'userId_sku'.
     * Se o usuário já teve esse SKU e deletou (soft delete), nós o restauramos (deletedAt: null).
     */
    const product = await prisma.product.upsert({
      where: {
        userId_sku: { 
          userId: userId, 
          sku: sku.trim().toUpperCase() 
        },
      },
      update: {
        name: name.trim(),
        cmv: Number(cmv),
        mlb: mlb || null,
        deletedAt: null, // ✅ Garante que o produto volte a ser ativo se estava deletado
        updatedAt: new Date(),
      },
      create: {
        userId: userId,
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        cmv: Number(cmv),
        mlb: mlb || null,
      },
    });

    console.log(`✓ Produto [${product.sku}] processado para o usuário ${userId}`);

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("Erro na API de produtos (POST):", error);
    
    // Erro de P2002 (Unique constraint) do Prisma caso a chave composta falhe
    if ((error as any).code === 'P2002') {
      return NextResponse.json({ error: "Este SKU já está ativo em sua conta." }, { status: 409 });
    }

    return NextResponse.json({ error: "Erro ao salvar produto" }, { status: 500 });
  }
}