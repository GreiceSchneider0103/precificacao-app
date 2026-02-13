import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const products = await prisma.product.findMany({
      where: { userId },
      orderBy: { sku: "asc" },
    });

    return NextResponse.json(products);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return NextResponse.json({ error: "Erro ao buscar produtos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json();
    const products = body?.products;

    if (!Array.isArray(products)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.product.deleteMany({ where: { userId } }),
      prisma.product.createMany({
        data: products.map((p: any) => ({
          userId,
          sku: String(p?.sku || "").trim().toUpperCase(),
          name: String(p?.name || ""),
          cmv: Number(p?.cmv) || 0,
          mlb: p?.mlb ? String(p.mlb) : null,
          // se teu model Product NÃO tiver updatedAt manual, remove a linha abaixo
          updatedAt: p?.updatedAt ? new Date(p.updatedAt) : new Date(),
        })),
        skipDuplicates: true,
      }),
    ]);

    return NextResponse.json({ success: true, count: products.length });
  } catch (error) {
    console.error("Erro ao salvar produtos:", error);
    return NextResponse.json({ error: "Erro ao salvar produtos" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return NextResponse.json({ error: "SKU não fornecido" }, { status: 400 });
    }

    await prisma.product.deleteMany({
      where: { userId, sku: sku.trim().toUpperCase() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar produto:", error);
    return NextResponse.json({ error: "Erro ao deletar produto" }, { status: 500 });
  }
}
