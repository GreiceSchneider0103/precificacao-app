import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros";
type Regime = "normal" | "simples";
type MeliPlan = "classic" | "premium";

type ShopeeTier = {
  min: number;
  max: number | null;
  commissionPercent: number;
  taxFixed: number;
};

type RuleSetData = {
  regime: Regime; // padrão: normal
  ufOrigem: string;

  channels: Record<
    ChannelKey,
    {
      enabled: boolean;
      commissionPercent: number; // “default” do canal (usado em geral)
      taxFixed: number; // R$ por item (ou taxa fixa)
      mainTaxPercent: number; // 18 ou 14 conforme regime
      targetMarginPercent: number; // margem desejada por canal
      // créditos (aplicados no regime normal)
      hasCredits?: boolean;
      creditFretePercent?: number;
      creditCommissionPercent?: number;
    }
  >;

  // MELI: diferenciação premium x clássico
  meli: {
    plan: MeliPlan;
    classicActive: boolean;
    premiumActive: boolean;
    classicCommissionPercent: number;
    premiumCommissionPercent: number;
  };

  // Shopee: tabela por faixa (editável)
  shopeeTiers: ShopeeTier[];
};

// ===== defaults robustos =====
function defaultRuleSet(): RuleSetData {
  const regime: Regime = "normal";
  const mainTaxPercent = regime === "normal" ? 18 : 14;

  return {
    regime,
    ufOrigem: "RS",
    channels: {
      magalu: {
        enabled: true,
        commissionPercent: 18,
        taxFixed: 5,
        mainTaxPercent,
        targetMarginPercent: 15,
        hasCredits: true,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
      },
      meli: {
        enabled: true,
        commissionPercent: 0,
        taxFixed: 0,
        mainTaxPercent,
        targetMarginPercent: 13,
        hasCredits: true,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
      }, // comissão vem do bloco meli.plan
      shopee: {
        enabled: true,
        commissionPercent: 0,
        taxFixed: 0,
        mainTaxPercent,
        targetMarginPercent: 15,
        hasCredits: true,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
      }, // vem de tiers
      site: {
        enabled: true,
        commissionPercent: 1,
        taxFixed: 0,
        mainTaxPercent,
        targetMarginPercent: 20,
        hasCredits: false,
        creditFretePercent: 0,
        creditCommissionPercent: 0,
      },
      outros: {
        enabled: true,
        commissionPercent: 18,
        taxFixed: 0,
        mainTaxPercent,
        targetMarginPercent: 20,
        hasCredits: true,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
      },
    },
    meli: {
      plan: "premium",
      // both plans available by default
      classicActive: true,
      premiumActive: true,
      // Defaults updated per request
      classicCommissionPercent: 11.5,
      premiumCommissionPercent: 16.5,
    },
    shopeeTiers: [
      { min: 0, max: 79.99, commissionPercent: 20, taxFixed: 4 },
      { min: 80, max: 99.99, commissionPercent: 14, taxFixed: 16 },
      { min: 100, max: 199.99, commissionPercent: 14, taxFixed: 20 },
      { min: 200, max: 499.99, commissionPercent: 14, taxFixed: 26 },
      { min: 500, max: null, commissionPercent: 14, taxFixed: 26 },
    ],
  };
}

function clampNumber(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeData(input: any): RuleSetData {
  const base = defaultRuleSet();

  const regime: Regime = input?.regime === "simples" ? "simples" : "normal";
  const mainTaxPercent = regime === "normal" ? 18 : 14;

  const ufOrigem = typeof input?.ufOrigem === "string" && input.ufOrigem.trim() ? input.ufOrigem.trim() : "RS";

  const channels = base.channels;
  for (const k of Object.keys(channels) as ChannelKey[]) {
    const incoming = input?.channels?.[k] ?? {};
    channels[k] = {
      enabled: Boolean(incoming?.enabled ?? channels[k].enabled),
      commissionPercent: clampNumber(incoming?.commissionPercent, channels[k].commissionPercent),
      taxFixed: clampNumber(incoming?.taxFixed, channels[k].taxFixed),
      targetMarginPercent: clampNumber(incoming?.targetMarginPercent, channels[k].targetMarginPercent),
      mainTaxPercent,
      hasCredits: typeof incoming?.hasCredits === "boolean" ? incoming.hasCredits : Boolean(channels[k].hasCredits ?? true),
      creditFretePercent: clampNumber(incoming?.creditFretePercent, channels[k].creditFretePercent ?? 21.25),
      creditCommissionPercent: clampNumber(incoming?.creditCommissionPercent, channels[k].creditCommissionPercent ?? 9.25),
    };
  }

  const meliPlan: MeliPlan = input?.meli?.plan === "classic" ? "classic" : "premium";
  const meliClassic = clampNumber(input?.meli?.classicCommissionPercent, base.meli.classicCommissionPercent);
  const meliPremium = clampNumber(input?.meli?.premiumCommissionPercent, base.meli.premiumCommissionPercent);
  const meliClassicActive = Boolean((input?.meli?.classicActive ?? base.meli.classicActive));
  const meliPremiumActive = Boolean((input?.meli?.premiumActive ?? base.meli.premiumActive));

  const shopeeTiersRaw = Array.isArray(input?.shopeeTiers) ? input.shopeeTiers : base.shopeeTiers;
  const shopeeTiers: ShopeeTier[] = shopeeTiersRaw
    .map((t: any) => ({
      min: clampNumber(t?.min, 0),
      max: t?.max === null || t?.max === "" || typeof t?.max === "undefined" ? null : clampNumber(t?.max, null as any),
      commissionPercent: clampNumber(t?.commissionPercent, 0),
      taxFixed: clampNumber(t?.taxFixed, 0),
    }))
    .sort((a: ShopeeTier, b: ShopeeTier) => a.min - b.min);

  return {
    regime,
    ufOrigem,
    channels,
    meli: {
      plan: meliPlan,
      classicActive: meliClassicActive,
      premiumActive: meliPremiumActive,
      classicCommissionPercent: meliClassic,
      premiumCommissionPercent: meliPremium,
    },
    shopeeTiers,
  };
}

async function getUserIdOrThrow() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) throw new Error("UNAUTHORIZED");
  return userId;
}

export async function GET() {
  try {
    const userId = await getUserIdOrThrow();

    const rows = await prisma.markup_settings_rulesets_v1.findMany({
      where: { userId },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });

    // se não existir nenhum, cria padrão automaticamente
    if (rows.length === 0) {
      const created = await prisma.markup_settings_rulesets_v1.create({
        data: {
          userId,
          name: "Padrão (Regime Normal)",
          isActive: true,
          data: defaultRuleSet(),
        },
      });
      return NextResponse.json({ rulesets: [created] });
    }

    return NextResponse.json({ rulesets: rows });
  } catch (e: any) {
    if (String(e?.message) === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load rulesets" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getUserIdOrThrow();
    const body = await req.json();

    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "Nova Regra";
    const data = normalizeData(body?.data ?? defaultRuleSet());

    const created = await prisma.markup_settings_rulesets_v1.create({
      data: { userId, name, isActive: false, data },
    });

    return NextResponse.json({ created });
  } catch {
    return NextResponse.json({ error: "Failed to create ruleset" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await getUserIdOrThrow();
    const body = await req.json();

    const id = String(body?.id ?? "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const action = String(body?.action ?? "save");

    // action: "activate" => marca como ativa e desativa outras
    if (action === "activate") {
      await prisma.$transaction([
        prisma.markup_settings_rulesets_v1.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false },
        }),
        prisma.markup_settings_rulesets_v1.update({
          where: { id },
          data: { isActive: true },
        }),
      ]);
      return NextResponse.json({ ok: true });
    }

    // action: "rename"
    if (action === "rename") {
      const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "Regra";
      const updated = await prisma.markup_settings_rulesets_v1.update({
        where: { id },
        data: { name },
      });
      return NextResponse.json({ updated });
    }

    // default: "save" => salva data
    const data = normalizeData(body?.data ?? defaultRuleSet());

    const updated = await prisma.markup_settings_rulesets_v1.update({
      where: { id },
      data: { data },
    });

    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ error: "Failed to update ruleset" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await getUserIdOrThrow();
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const row = await prisma.markup_settings_rulesets_v1.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (row.isActive) return NextResponse.json({ error: "Cannot delete active ruleset" }, { status: 400 });

    await prisma.markup_settings_rulesets_v1.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete ruleset" }, { status: 500 });
  }
}
