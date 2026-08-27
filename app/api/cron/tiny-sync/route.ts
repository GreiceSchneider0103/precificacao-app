// app/api/cron/tiny-sync/route.ts
//
// Disparado semanalmente pelo Vercel Cron (ver vercel.json). Autenticado por
// Authorization: Bearer $CRON_SECRET (convenção padrão do Vercel Cron — configurar a
// env var CRON_SECRET no projeto Vercel). Não usa sessão de usuário: percorre TODAS as
// empresas (de todas as contas) que tiverem um token do Tiny configurado.
//
// Uma função serverless não dá conta de um catálogo de centenas de SKUs numa única
// invocação (orçamento de tempo curto, ~50s aqui). Por isso, se ainda sobrar trabalho ao
// fim de uma invocação, ela mesma dispara a próxima (auto-encadeamento via `after()`),
// até um limite de saltos — assim o disparo semanal do Vercel Cron vira, na prática,
// várias invocações em sequência automaticamente, sem precisar agendar o cron com mais
// frequência (o que exigiria um plano Vercel pago para intervalos menores que 1 dia).
import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { runTinySyncBatch } from "@/lib/tiny";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_BUDGET_MS = 50000;
const MAX_CHAIN_HOPS = 8; // ~8 saltos de ~50s ≈ 6-7 min de progresso automático por disparo

function splitBudget(totalMs: number, count: number) {
  return Math.max(2000, Math.floor(totalMs / Math.max(1, count)));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const hop = Number(request.nextUrl.searchParams.get("hop") ?? "0");

  try {
    const empresas = await prisma.markupRuleset.findMany({
      where: { tinyApiToken: { not: null } },
      select: { id: true, name: true, userId: true },
    });

    if (empresas.length === 0) {
      return NextResponse.json({ ok: true, empresas: [], hop });
    }

    const perEmpresaBudget = splitBudget(CRON_BUDGET_MS, empresas.length);
    const results: { empresaId: string; name: string; done?: boolean; blocked?: boolean; error?: string }[] = [];
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

    const stillPending = results.some((r) => r.done === false);
    const anyBlocked = results.some((r) => r.blocked);

    // Não encadeia na hora se algum bloqueio "duro" do Tiny foi detectado: esperar
    // minutos dentro de uma função serverless desperdiça o orçamento à toa — melhor
    // deixar o próximo salto natural (disparo semanal seguinte, ou o botão manual)
    // continuar depois que o bloqueio já tiver passado.
    const willChain = stillPending && !anyBlocked && hop < MAX_CHAIN_HOPS;
    if (willChain) {
      const nextUrl = new URL(request.nextUrl.pathname, request.nextUrl.origin);
      nextUrl.searchParams.set("hop", String(hop + 1));
      after(async () => {
        // Não espera a próxima invocação terminar (ela mesma leva ~50s) — só precisa
        // garantir que a requisição saiu antes desta função ser encerrada. Uma vez que a
        // invocação seguinte começou a rodar no servidor, ela segue independente mesmo
        // que este fetch seja abortado por timeout aqui.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          await fetch(nextUrl.toString(), { headers: { authorization: `Bearer ${secret}` }, signal: controller.signal });
        } catch {
          // best-effort: se o encadeamento falhar, a sincronização semanal seguinte retoma do ponto salvo
        } finally {
          clearTimeout(timeout);
        }
      });
    }

    return NextResponse.json({ ok: true, empresas: results, hop, chained: willChain });
  } catch (error) {
    console.error("[GET /api/cron/tiny-sync]", error);
    return NextResponse.json({ error: "Erro na sincronização semanal" }, { status: 500 });
  }
}
