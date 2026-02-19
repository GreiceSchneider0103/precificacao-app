import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOwnedProduct, deleteOwnedProduct } from "@/lib/db/products";

// 🗑️ DELETE - Deleta apenas se for o dono (Soft Delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    // Tópico C: Só marca como deletado se o ID E o USERID baterem no banco
    const result = await deleteOwnedProduct(params.id, userId);

    if (result.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado ou sem permissão" }, { status: 404 });
    }

    return NextResponse.json({ message: "Produto removido com sucesso" });
  } catch (error) {
    return NextResponse.json({ error: "Erro ao deletar" }, { status: 500 });
  }
}

// 📝 PATCH - Atualiza apenas se for o dono
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json();
    
    // Tópico C: Primeiro verifica se o produto existe e pertence ao usuário
    const product = await getOwnedProduct(params.id, userId);
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado ou acesso negado" }, { status: 403 });
    }

    const updated = await prisma.product.update({
      where: { id: params.id },
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