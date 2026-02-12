import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email ? String(session.user.email).trim() : "";

  if (!email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json();

  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json(
      { error: "Nova senha deve ter ao menos 6 caracteres" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { passwordHash: true },
  });

  // Se já existe senha, exige e valida a atual
  if (user?.passwordHash) {
    if (!currentPassword || typeof currentPassword !== "string") {
      return NextResponse.json({ error: "Informe a senha atual" }, { status: 400 });
    }

    const valid = await compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
    }
  }

  const newHash = await hash(newPassword, 12);

  await prisma.user.update({
    where: { email },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}
