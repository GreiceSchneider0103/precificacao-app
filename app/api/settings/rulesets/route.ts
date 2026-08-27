// app/api/settings/rulesets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSessionOrThrow } from "@/lib/utils";
import { getEmpresaAccess } from "@/lib/access";
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
 * GET: Carrega as empresas que o usuário pode ver — as que ele é dono + as que um
 * usuário master concedeu acesso (ver /usuarios). `isOwner` diz ao cliente quais ações
 * (renomear, excluir, ativar como padrão, criar novas) ficam disponíveis: essas seguem
 * restritas ao dono, mesmo com acesso completo aos dados (Precificação/Produtos/config).
 */
export async function GET() {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;

    const [owned, granted] = await Promise.all([
      prisma.markupRuleset.findMany({ where: { userId }, orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] }),
      prisma.empresaAccess.findMany({ where: { userId }, select: { empresaId: true } }),
    ]);

    const grantedIds = granted.map((g) => g.empresaId);
    const grantedRows =
      grantedIds.length > 0
        ? await prisma.markupRuleset.findMany({ where: { id: { in: grantedIds } }, orderBy: { updatedAt: "desc" } })
        : [];

    // Autoprovisiona uma primeira empresa só para a própria conta master, na primeira
    // vez que ela acessa — nunca para um usuário concedido, que só deve ver o que um
    // master explicitamente compartilhou com ele.
    if (owned.length === 0 && grantedRows.length === 0) {
      if (session.user.role !== "MASTER") {
        return NextResponse.json({ rulesets: [] });
      }
      const created = await prisma.markupRuleset.create({
        data: {
          userId,
          name: "Configuração Padrão",
          isActive: true,
          data: defaultRuleSet() as any,
        },
      });
      return NextResponse.json({ rulesets: [{ ...created, isOwner: true }] });
    }

    const rulesets = [
      ...owned.map((r) => ({ ...r, isOwner: true })),
      ...grantedRows.map((r) => ({ ...r, isOwner: false })),
    ];

    return NextResponse.json({ rulesets });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === "Unauthorized" ? 401 : 500 });
  }
}

/**
 * POST: Cria nova empresa — só usuários MASTER (concedem acesso depois em /usuarios).
 */
export async function POST(req: Request) {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    if (session.user.role !== "MASTER") {
      return NextResponse.json({ error: "Só um usuário master pode criar empresas" }, { status: 403 });
    }
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
 * PUT: Atualiza (dono ou usuário com acesso concedido) ou renomeia/ativa como padrão
 * (só o dono — essas são ações de administração da empresa, não do dia a dia).
 */
export async function PUT(req: Request) {
  try {
    const session = await getSessionOrThrow();
    const userId = session.user.id;
    const body = await req.json();
    const { id, action } = body;

    if (!id) return NextResponse.json({ error: "ID ausente" }, { status: 400 });

    const access = await getEmpresaAccess(userId, id);
    if (!access) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    if (action === "activate" || action === "rename") {
      if (!access.isOwner) {
        return NextResponse.json({ error: "Só o dono da empresa pode fazer isso" }, { status: 403 });
      }
    }

    const existing = await prisma.markupRuleset.findUniqueOrThrow({ where: { id } });

    if (action === "activate") {
      await prisma.$transaction([
        prisma.markupRuleset.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false },
        }),
        prisma.markupRuleset.update({
          where: { id },
          data: { isActive: true },
        }),
      ]);
      revalidatePath("/precificacao");
      return NextResponse.json({ ok: true });
    }

    if (action === "rename") {
      const renamed = await prisma.markupRuleset.update({
        where: { id },
        data: { name: body.name ?? existing.name },
      });
      return NextResponse.json({ updated: renamed });
    }

    const updated = await prisma.markupRuleset.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        data: body.data ? (normalizeData(body.data) as any) : existing.data,
        tinyApiToken: body.tinyApiToken !== undefined ? body.tinyApiToken : existing.tinyApiToken,
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
 * DELETE: Remove uma empresa — só o dono.
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