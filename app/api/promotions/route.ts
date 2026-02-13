import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const promotions = await prisma.promotion.findMany({
      where: {
        userId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(promotions);
  } catch (error) {
    console.error("Erro ao buscar promoções:", error);
    return NextResponse.json({ error: "Erro ao buscar promoções" }, { status: 500 });
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
    const promotions = body?.promotions;

    if (!Array.isArray(promotions)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.promotion.deleteMany({ where: { userId } }),
      prisma.promotion.createMany({
        data: promotions.map((p: any) => ({
          userId,
          sku: String(p?.sku || ""),
          name: String(p?.name || ""),
          channel: String(p?.channel || ""),
          originalPrice: Number(p?.originalPrice) || 0,
          promoPrice: Number(p?.promoPrice) || 0,
          startDate: new Date(p?.startDate),
          endDate: new Date(p?.endDate),
          isActive: Boolean(p?.isActive ?? true),
          updatedAt: p?.updatedAt ? new Date(p.updatedAt) : new Date(),
        })),
        skipDuplicates: true,
      }),
    ]);

    return NextResponse.json({ success: true, count: promotions.length });
  } catch (error) {
    console.error("Erro ao salvar promoções:", error);
    return NextResponse.json({ error: "Erro ao salvar promoções" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    await prisma.promotion.deleteMany({ where: { userId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao limpar promoções:", error);
    return NextResponse.json({ error: "Erro ao limpar promoções" }, { status: 500 });
  }
}
