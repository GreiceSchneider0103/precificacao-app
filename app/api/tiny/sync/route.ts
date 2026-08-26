// app/api/tiny/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runTinySyncBatch } from "@/lib/tiny";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MANUAL_BUDGET_MS = 8000;

// Divide o orçamento de tempo entre várias empresas (modo "atualizar todas"), com um
// piso mínimo por empresa para não deixar nenhuma sem progresso quando há muitas.
function splitBudget(totalMs: number, count: number) {
  return Math.max(2000, Math.floor(totalMs / Math.max(1, count)));
}

/**
 * POST { empresaId } — sincroniza o CMV dos produtos de uma empresa a partir do Tiny.
 * POST { all: true } — sincroniza todas as empresas da conta (só para role MASTER).
 * O cliente chama esta rota repetidamente até `done: true`, mostrando progresso.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await request.json()) as { empresaId?: string; all?: boolean };

    if (body.all) {
      if (session?.user?.role !== "MASTER") {
        return NextResponse.json(
          { error: "Só o usuário master pode atualizar todas as empresas de uma vez" },
          { status: 403 }
        );
      }

      const empresas = await prisma.markupRuleset.findMany({
        where: { userId, tinyApiToken: { not: null } },
        select: { id: true, name: true },
      });

      if (empresas.length === 0) {
        return NextResponse.json({ mode: "all", done: true, empresas: [] });
      }

      const perEmpresaBudget = splitBudget(MANUAL_BUDGET_MS, empresas.length);
      const results = [];
      for (const empresa of empresas) {
        const r = await runTinySyncBatch(empresa.id, { budgetMs: perEmpresaBudget });
        results.push({ empresaId: empresa.id, name: empresa.name, ...r });
      }

      return NextResponse.json({ mode: "all", done: results.every((r) => r.done), empresas: results });
    }

    const empresaId = body.empresaId;
    if (!empresaId || typeof empresaId !== "string") {
      return NextResponse.json({ error: "empresaId é obrigatório" }, { status: 400 });
    }

    const empresa = await prisma.markupRuleset.findFirst({ where: { id: empresaId, userId } });
    if (!empresa) {
      return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
    }
    if (!empresa.tinyApiToken) {
      return NextResponse.json(
        { error: "Configure o token do Tiny para esta empresa em Configurações" },
        { status: 400 }
      );
    }

    const result = await runTinySyncBatch(empresaId, { budgetMs: MANUAL_BUDGET_MS });
    return NextResponse.json({ mode: "single", empresaId, ...result });
  } catch (error) {
    console.error("[POST /api/tiny/sync]", error);
    return NextResponse.json({ error: "Erro ao sincronizar com o Tiny" }, { status: 500 });
  }
}
