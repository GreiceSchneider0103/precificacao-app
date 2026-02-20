// app/api/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET: Lista produtos do usuário logado
 */
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const products = await prisma.product.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        sku: true,
        name: true,
        cmv: true,
        mlb: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // ✅ Garante que cmv sempre vem como número (Prisma Decimal → Number)
    const normalized = products.map((p) => ({
      ...p,
      cmv: Number(p.cmv),
    }));

    return NextResponse.json({ products: normalized, total: normalized.length });
  } catch (error) {
    console.error("[GET /api/products]", error);
    return NextResponse.json({ error: "Erro interno ao buscar produtos" }, { status: 500 });
  }
}

/**
 * POST: Cria ou atualiza um produto (upsert por userId + sku)
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

    // Validação
    if (!sku || typeof sku !== "string" || !sku.trim()) {
      return NextResponse.json({ error: "SKU é obrigatório" }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
    }
    if (cmv === undefined || cmv === null || cmv === "") {
      return NextResponse.json({ error: "CMV é obrigatório" }, { status: 400 });
    }

    const cmvNum = typeof cmv === "string"
      ? parseFloat(cmv.replace(/\./g, "").replace(",", "."))
      : Number(cmv);

    if (!isFinite(cmvNum) || cmvNum <= 0) {
      return NextResponse.json({ error: "CMV inválido. Use um número maior que zero." }, { status: 400 });
    }

    const skuNorm = sku.trim().toUpperCase();

    // ✅ upsert: cria ou atualiza pelo par userId + sku
    const product = await prisma.product.upsert({
      where: {
        userId_sku: {
          userId,
          sku: skuNorm,
        },
      },
      update: {
        name: name.trim(),
        cmv: cmvNum,
        mlb: mlb ? String(mlb).trim() : null,
        updatedAt: new Date(),
      },
      create: {
        userId,
        sku: skuNorm,
        name: name.trim(),
        cmv: cmvNum,
        mlb: mlb ? String(mlb).trim() : null,
      },
    });

    return NextResponse.json(
      { ...product, cmv: Number(product.cmv) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/products]", error);

    // Unique constraint — SKU duplicado (raro com upsert, mas defensivo)
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Este SKU já existe na sua conta." },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: "Erro ao salvar produto" }, { status: 500 });
  }
}

/**
 * DELETE: Remove um produto pelo id
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID do produto é obrigatório" }, { status: 400 });
    }

    // ✅ garante que só deleta produtos do próprio usuário
    const product = await prisma.product.findFirst({
      where: { id, userId },
    });

    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    await prisma.product.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/products]", error);
    return NextResponse.json({ error: "Erro ao deletar produto" }, { status: 500 });
  }
}
