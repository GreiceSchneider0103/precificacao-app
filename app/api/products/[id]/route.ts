import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOwnedProduct, deleteOwnedProduct } from "@/lib/db/products";

// ✅ TIPAGEM PARA NEXT.JS 15/16
type RouteContext = {
  params: Promise<{ id: string }>;
};

// 🗑️ DELETE
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params; // OBRIGATÓRIO dar await
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const result = await deleteOwnedProduct(id, userId);

    if (result.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ message: "Removido com sucesso" });
  } catch (error) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

// 📝 PATCH
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params; // OBRIGATÓRIO dar await
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await request.json();
    
    const product = await getOwnedProduct(id, userId);
    if (!product) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const updated = await prisma.product.update({
      where: { id: id },
      data: {
        name: body.name,
        cmv: body.cmv ? Number(body.cmv) : undefined,
        mlb: body.mlb
      }
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}