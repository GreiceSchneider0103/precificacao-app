import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOwnedProduct, deleteOwnedProduct } from "@/lib/db/products";

// 🗑️ DELETE - Next.js 15/16 exige Promise para params
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // 👈 Tipagem correta
) {
  try {
    const { id } = await params; // 👈 OBRIGATÓRIO dar await no params
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const result = await deleteOwnedProduct(id, userId);

    if (result.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado ou sem permissão" }, { status: 404 });
    }

    return NextResponse.json({ message: "Produto removido com sucesso" });
  } catch (error) {
    return NextResponse.json({ error: "Erro ao deletar" }, { status: 500 });
  }
}

// 📝 PATCH - Next.js 15/16 exige Promise para params
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // 👈 Tipagem correta
) {
  try {
    const { id } = await params; // 👈 OBRIGATÓRIO dar await no params
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json();
    
    const product = await getOwnedProduct(id, userId);
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado ou acesso negado" }, { status: 403 });
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