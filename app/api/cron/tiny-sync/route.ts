// app/api/cron/tiny-sync/route.ts
//
// Disparado semanalmente pelo Vercel Cron (ver vercel.json). Autenticado por
// Authorization: Bearer $CRON_SECRET (convenção padrão do Vercel Cron — configurar a
// env var CRON_SECRET no projeto Vercel). Não usa sessão de usuário: percorre TODAS as
// empresas (de todas as contas) que tiverem um token do Tiny configurado.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runTinySyncBatch } from "@/lib/tiny";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_BUDGET_MS = 50000;

function splitBudget(totalMs: number, count: number) {
  return Math.max(2000, Math.floor(totalMs / Math.max(1, count)));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const empresas = await prisma.markupRuleset.findMany({
      where: { tinyApiToken: { not: null } },
      select: { id: true, name: true, userId: true },
    });

    if (empresas.length === 0) {
      return NextResponse.json({ ok: true, empresas: [] });
    }

    const perEmpresaBudget = splitBudget(CRON_BUDGET_MS, empresas.length);
    const results = [];
    for (const empresa of empresas) {
      try {
        const r = await runTinySyncBatch(empresa.id, { budgetMs: perEmpresaBudget });
        results.push({ empresaId: empresa.id, name: empresa.name, ...r });
      } catch (err) {
        results.push({
          empresaId: empresa.id,
          name: empresa.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, empresas: results });
  } catch (error) {
    console.error("[GET /api/cron/tiny-sync]", error);
    return NextResponse.json({ error: "Erro na sincronização semanal" }, { status: 500 });
  }
}
