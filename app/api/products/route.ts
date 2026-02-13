import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function toNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSku(v: unknown) {
  return String(v ?? "").trim().toUpperCase();
}

function normalizeMlb(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  const m = s.match(/MLB\d+/i);
  if (m?.[0]) return m[0].toUpperCase();
  if (/^\d+$/.test(s)) return `MLB${s}`;
  return s || null;
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : "";

  if (!userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    where: { userId },
    orderBy: { sku: "asc" },
    select: { sku: true, name: true, cmv: true, mlb: true, updatedAt: true },
  });

  return NextResponse.json({ products });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : "";

  if (!userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const incoming = Array.isArray(body?.products) ? body.products : [];

  const now = new Date();

  const next = incoming
    .map((p: any) => {
      const sku = normalizeSku(p?.sku);
      if (!sku) return null;

      const name = String(p?.name ?? sku).trim() || sku;
      const cmv = Math.round(toNumber(p?.cmv) * 100) / 100;
      const mlb = normalizeMlb(p?.mlb);

      return {
        userId,
        sku,
        name,
        cmv,
        mlb,
        updatedAt: now,
      };
    })
    .filter(Boolean) as Array<{
    userId: string;
    sku: string;
    name: string;
    cmv: number;
    mlb: string | null;
    updatedAt: Date;
  }>;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.deleteMany({ where: { userId } });
      if (next.length) {
        await tx.product.createMany({ data: next });
      }
    });

    return NextResponse.json({ ok: true, count: next.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erro ao salvar produtos" }, { status: 500 });
  }
}