// app/api/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { upsertProductBySku } from "@/lib/db/products";
import { getEmpresaAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET: Lista produtos. Aceita ?empresaId= para filtrar por empresa (use "none" para os
 * produtos legados sem empresa atribuída, sempre restritos ao próprio dono). Produtos de
 * uma empresa real são dados COMPARTILHADOS entre o dono e quem tiver acesso concedido —
 * por isso, com empresaId real, a busca não filtra mais por userId, só por acesso.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const empresaId = new URL(request.url).searchParams.get("empresaId");

    let where: { userId?: string; empresaId?: string | null; deletedAt: null };
    if (empresaId === "none") {
      where = { userId, empresaId: null, deletedAt: null };
    } else if (empresaId) {
      const access = await getEmpresaAccess(userId, empresaId);
      if (!access) return NextResponse.json({ error: "Você não tem acesso a esta empresa" }, { status: 403 });
      where = { empresaId, deletedAt: null };
    } else {
      where = { userId, deletedAt: null };
    }

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
 * POST: Cria ou atualiza um produto (upsert por dono-da-empresa + empresaId + sku).
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

    // Produto de empresa real: pertence à conta DONA da empresa (dado compartilhado),
    // não a quem estiver logado no momento salvando.
    let ownerUserId = userId;
    if (empresaIdNorm !== null) {
      const access = await getEmpresaAccess(userId, empresaIdNorm);
      if (!access) return NextResponse.json({ error: "Você não tem acesso a esta empresa" }, { status: 403 });
      ownerUserId = access.ownerUserId;
    }

    const product = await upsertProductBySku({
      userId: ownerUserId,
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
        { error: "Este SKU já existe nesta empresa." },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: "Erro ao salvar produto" }, { status: 500 });
  }
}

/**
 * DELETE: Remove um produto pelo id, ou todos de uma empresa (?empresaId=X&all=true).
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
      if (empresaParam === "none") {
        const result = await prisma.product.deleteMany({ where: { userId, empresaId: null } });
        return NextResponse.json({ success: true, deleted: result.count });
      }
      const access = await getEmpresaAccess(userId, empresaParam);
      if (!access) return NextResponse.json({ error: "Você não tem acesso a esta empresa" }, { status: 403 });
      const result = await prisma.product.deleteMany({ where: { empresaId: empresaParam } });
      return NextResponse.json({ success: true, deleted: result.count });
    }

    if (!id) {
      return NextResponse.json({ error: "ID do produto é obrigatório" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    if (product.empresaId) {
      const access = await getEmpresaAccess(userId, product.empresaId);
      if (!access) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    } else if (product.userId !== userId) {
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
 * PUT: Upsert em lote — usada para salvar só os produtos que de fato mudaram (não a base
 * inteira), ver ProdutosClient.tsx. Cada item pertence à conta DONA da sua empresa.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json() as { products?: unknown[] };
    const products = body?.products as
      | { sku: string; name: string; cmv: number; mlb?: string | null; empresaId?: string | null }[]
      | undefined;

    if (!Array.isArray(products)) {
      return NextResponse.json({ error: "Lista de produtos inválida" }, { status: 400 });
    }

    // Resolve o dono real de cada empresaId distinto presente no lote uma única vez
    // (evita repetir a checagem de acesso a cada item quando o lote inteiro é da mesma
    // empresa, o caso comum).
    const ownerByEmpresaId = new Map<string, string>();
    for (const p of products) {
      const empresaId = p.empresaId ? String(p.empresaId) : null;
      if (empresaId === null || ownerByEmpresaId.has(empresaId)) continue;
      const access = await getEmpresaAccess(userId, empresaId);
      if (!access) return NextResponse.json({ error: "Você não tem acesso a uma das empresas enviadas" }, { status: 403 });
      ownerByEmpresaId.set(empresaId, access.ownerUserId);
    }

    await Promise.all(
      products.map((p) => {
        const empresaId = p.empresaId ? String(p.empresaId) : null;
        return upsertProductBySku({
          userId: empresaId ? ownerByEmpresaId.get(empresaId)! : userId,
          empresaId,
          sku: p.sku.trim().toUpperCase(),
          name: p.name.trim(),
          cmv: Number(p.cmv),
          mlb: p.mlb ? String(p.mlb).trim() : null,
        });
      })
    );

    return NextResponse.json({ success: true, total: products.length });
  } catch (error) {
    console.error("[PUT /api/products]", error);
    return NextResponse.json({ error: "Erro ao salvar produtos" }, { status: 500 });
  }
}
