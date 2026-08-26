// app/api/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { upsertProductBySku } from "@/lib/db/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET: Lista produtos do usuário logado. Aceita ?empresaId= para filtrar por empresa
 * (use "none" para listar só os produtos legados sem empresa atribuída). Sem o
 * parâmetro, retorna todos os produtos da conta (compatibilidade retroativa).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const empresaId = new URL(request.url).searchParams.get("empresaId");
    const where =
      empresaId === "none"
        ? { userId, empresaId: null }
        : empresaId
        ? { userId, empresaId }
        : { userId };

    const products = await prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        sku: true,
        name: true,
        cmv: true,
        mlb: true,
        empresaId: true,
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
    const { sku, name, cmv, mlb, empresaId } = body;

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
    const empresaIdNorm: string | null = empresaId ? String(empresaId) : null;

    // ✅ upsert: cria ou atualiza pelo trio userId + empresaId + sku
    const product = await upsertProductBySku({
      userId,
      empresaId: empresaIdNorm,
      sku: skuNorm,
      name: name.trim(),
      cmv: cmvNum,
      mlb: mlb ? String(mlb).trim() : null,
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
    const empresaParam = searchParams.get("empresaId");
    const clearAll = searchParams.get("all") === "true";

    // Limpa todos os produtos de uma empresa de uma vez (?empresaId=X&all=true, ou
    // ?empresaId=none&all=true para os produtos legados sem empresa).
    if (clearAll) {
      if (empresaParam === null) {
        return NextResponse.json({ error: "empresaId é obrigatório" }, { status: 400 });
      }
      const empresaId = empresaParam === "none" ? null : empresaParam;
      const result = await prisma.product.deleteMany({ where: { userId, empresaId } });
      return NextResponse.json({ success: true, deleted: result.count });
    }

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

/**
 * PUT: Substitui toda a base de produtos do usuário (bulk upsert)
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json() as { products?: unknown[] };
    const products = body?.products;

    if (!Array.isArray(products)) {
      return NextResponse.json({ error: "Lista de produtos inválida" }, { status: 400 });
    }

    // Upsert de cada produto da lista
    await Promise.all(
      products.map((p) => {
        const prod = p as { sku: string; name: string; cmv: number; mlb?: string | null; empresaId?: string | null };
        return upsertProductBySku({
          userId,
          empresaId: prod.empresaId ? String(prod.empresaId) : null,
          sku: prod.sku.trim().toUpperCase(),
          name: prod.name.trim(),
          cmv: Number(prod.cmv),
          mlb: prod.mlb ? String(prod.mlb).trim() : null,
        });
      })
    );

    return NextResponse.json({ success: true, total: products.length });
  } catch (error) {
    console.error("[PUT /api/products]", error);
    return NextResponse.json({ error: "Erro ao salvar produtos" }, { status: 500 });
  }
}