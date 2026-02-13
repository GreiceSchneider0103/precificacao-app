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
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const channel = searchParams.get("channel");

    const history = await prisma.pricingHistory.findMany({
      where: {
        userId,
        ...(channel ? { channel } : {}),
      },
      orderBy: { calculatedAt: "desc" },
      take: limit,
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error("Erro ao buscar histórico:", error);
    return NextResponse.json({ error: "Erro ao buscar histórico" }, { status: 500 });
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
    const entries = body?.entries;

    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    await prisma.pricingHistory.createMany({
      data: entries.map((e: any) => ({
        userId,
        sku: String(e?.sku || ""),
        name: String(e?.name || ""),
        cmv: Number(e?.cmv) || 0,
        channel: String(e?.channel || ""),
        suggestedPrice: Number(e?.suggestedPrice) || 0,
        finalPrice: Number(e?.finalPrice) || 0,
        margin: Number(e?.margin) || 0,
        calculatedAt: e?.calculatedAt ? new Date(e.calculatedAt) : new Date(),
      })),
    });

    return NextResponse.json({ success: true, count: entries.length });
  } catch (error) {
    console.error("Erro ao salvar histórico:", error);
    return NextResponse.json({ error: "Erro ao salvar histórico" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    await prisma.pricingHistory.deleteMany({ where: { userId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar histórico:", error);
    return NextResponse.json({ error: "Erro ao deletar histórico" }, { status: 500 });
  }
}
