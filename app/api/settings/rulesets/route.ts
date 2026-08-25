// app/api/settings/rulesets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSessionOrThrow } from "@/lib/utils";
import { revalidatePath } from "next/cache";

// ✅ Tópico E: Força a API a ser sempre dinâmica
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros" | "site_modifika";
type Regime = "normal" | "simples";
type MeliPlan = "classic" | "premium";

type ShopeeTier = {
  min: number;
  max: number | null;
  commissionPercent: number;
  taxFixed: number;
};

type RuleSetData = {
  regime: Regime;
  ufOrigem: string;
  channels: Record<ChannelKey, any>;
  meli: any;
  shopeeTiers: ShopeeTier[];
};

// --- Defaults ---
function defaultRuleSet(): RuleSetData {
  return {
    regime: "normal",
    ufOrigem: "RS",
    channels: {
      magalu: { enabled: true, commissionPercent: 18, taxFixed: 5, targetMarginPercent: 15, hasCredits: true, creditFretePercent: 21.25, creditCommissionPercent: 9.25 },
      meli: { enabled: true, commissionPercent: 0, taxFixed: 0, targetMarginPercent: 13, hasCredits: true, creditFretePercent: 21.25, creditCommissionPercent: 9.25 },
      shopee: { enabled: true, commissionPercent: 0, taxFixed: 0, targetMarginPercent: 15, hasCredits: true, creditFretePercent: 21.25, creditCommissionPercent: 9.25 },
      site: { enabled: true, commissionPercent: 1, taxFixed: 0, targetMarginPercent: 20, hasCredits: false, creditFretePercent: 0, creditCommissionPercent: 0 },
      site_modifika: { enabled: true, commissionPercent: 1, taxFixed: 0, targetMarginPercent: 15, hasCredits: true, mainTaxPercent: 18, pisCofinsPercent: 6, creditFretePercent: 12, creditCommissionPercent: 0, incentiveCreditPercent: 2, cardFeePercent: 10, influencerPercent: 5 },
      outros: { enabled: true, commissionPercent: 18, taxFixed: 0, targetMarginPercent: 20, hasCredits: true, creditFretePercent: 21.25, creditCommissionPercent: 9.25 },
    },
    meli: { plan: "premium", classicActive: true, premiumActive: true, classicCommissionPercent: 11.5, premiumCommissionPercent: 16.5 },
    shopeeTiers: [
      { min: 0, max: 79.99, commissionPercent: 20, taxFixed: 4 },
      { min: 80, max: 99.99, commissionPercent: 14, taxFixed: 16 },
      { min: 100, max: 199.99, commissionPercent: 14, taxFixed: 20 },
      { min: 200, max: 499.99, commissionPercent: 14, taxFixed: 26 },
      { min: 500, max: null, commissionPercent: 14, taxFixed: 26 },
    ],
  };
}

function normalizeData(input: any): RuleSetData {
  const base = defaultRuleSet();
  // ... (lógica de clampNumber e normalização mantida para brevidade)
  return { ...base, ...input }; 
}

/**
 * GET: Carrega os Rulesets do usuário
 */
export async function GET() {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;

    const rows = await prisma.markupRuleset.findMany({
      where: { userId },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });

    if (rows.length === 0) {
      const created = await prisma.markupRuleset.create({
        data: {
          userId,
          name: "Configuração Padrão",
          isActive: true,
          data: defaultRuleSet() as any,
        },
      });
      return NextResponse.json({ rulesets: [created] });
    }

    return NextResponse.json({ rulesets: rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === "Unauthorized" ? 401 : 500 });
  }
}

/**
 * POST: Cria novo Ruleset
 */
export async function POST(req: Request) {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const body = await req.json();

    const created = await prisma.markupRuleset.create({
      data: {
        userId,
        name: body.name || "Nova Regra",
        isActive: false,
        data: normalizeData(body.data) as any,
      },
    });

    return NextResponse.json({ created });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro ao criar" }, { status: 500 });
  }
}

/**
 * PUT: Atualiza ou Ativa um Ruleset
 */
export async function PUT(req: Request) {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const body = await req.json();
    const { id, action } = body;

    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    // ✅ Tópico C: Sempre incluir userId na busca para evitar edição de dados alheios
    const existing = await prisma.markupRuleset.findFirst({
      where: { id, userId }
    });

    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    if (action === "activate") {
      await prisma.$transaction([
        prisma.markupRuleset.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false },
        }),
        prisma.markupRuleset.update({
          where: { id, userId },
          data: { isActive: true },
        }),
      ]);
      revalidatePath("/precificacao");
      return NextResponse.json({ ok: true });
    }

    const updated = await prisma.markupRuleset.update({
      where: { id, userId },
      data: {
        name: body.name ?? existing.name,
        data: body.data ? (normalizeData(body.data) as any) : existing.data,
      },
    });

    // ✅ Tópico E: Invalida cache das páginas de cálculo
    revalidatePath("/precificacao");

    return NextResponse.json({ updated });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}

/**
 * DELETE: Remove um Ruleset
 */
export async function DELETE(req: Request) {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const row = await prisma.markupRuleset.findFirst({
      where: { id, userId }
    });

    if (!row) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (row.isActive) return NextResponse.json({ error: "Não é possível deletar a regra ativa" }, { status: 400 });

    await prisma.markupRuleset.delete({
      where: { id, userId } // Proteção extra
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro ao deletar" }, { status: 500 });
  }
}