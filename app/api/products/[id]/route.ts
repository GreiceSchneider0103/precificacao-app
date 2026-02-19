import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOwnedProduct, deleteOwnedProduct } from "@/lib/db/products";

// 🗑️ DELETE - Deleta apenas se for o dono (Soft Delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // 👈 Mude para Promise
) {
  try {
    const { id } = await params; // 👈 Adicione esse await
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const result = await deleteOwnedProduct(id, userId); // 👈 Use o id aqui

    if (result.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ message: "Produto removido" });
  } catch (error) {
    return NextResponse.json({ error: "Erro ao deletar" }, { status: 500 });
  }
}

// 📝 PATCH - Atualiza apenas se for o dono
// app/api/products/[id]/route.ts

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // 👈 Mude para Promise
) {
  try {
    const { id } = await params; // 👈 Adicione esse await
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json();
    
    // Use o 'id' que você pegou do await params
    const product = await getOwnedProduct(id, userId); 
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 403 });
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