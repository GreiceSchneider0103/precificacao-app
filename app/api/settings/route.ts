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

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return NextResponse.json({ activeRuleId: null, ruleSets: [] });
    }

    return NextResponse.json({
      activeRuleId: settings.activeRuleId,
      ruleSets: JSON.parse(settings.rulesJson || "[]"),
    });
  } catch (error) {
    console.error("Erro ao buscar configurações:", error);
    return NextResponse.json({ error: "Erro ao buscar configurações" }, { status: 500 });
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
    const { activeRuleId, ruleSets } = body || {};

    if (!activeRuleId || !Array.isArray(ruleSets)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        activeRuleId: String(activeRuleId),
        rulesJson: JSON.stringify(ruleSets),
      },
      update: {
        activeRuleId: String(activeRuleId),
        rulesJson: JSON.stringify(ruleSets),
      },
    });

    return NextResponse.json({ success: true, activeRuleId: saved.activeRuleId });
  } catch (error) {
    console.error("Erro ao salvar configurações:", error);
    return NextResponse.json({ error: "Erro ao salvar configurações" }, { status: 500 });
  }
}
