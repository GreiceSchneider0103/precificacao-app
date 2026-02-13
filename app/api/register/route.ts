import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email e senha são obrigatórios." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: "Senha precisa ter no mínimo 6 caracteres." }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ ok: false, error: "Já existe uma conta com este e-mail." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        name: name || null,
        email,
        passwordHash,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e: any) {
    console.error("❌ /api/register error:", e?.message, e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erro ao cadastrar." },
      { status: 500 }
    );
  }
}
